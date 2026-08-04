require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const Razorpay = require('razorpay');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { message: 'Bahut zyada requests. Thodi der baad try karein.' },
});
app.use(generalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Bahut zyada attempts ho gaye. 15 minute baad try karein.' },
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('Database se connect ho gaya'))
  .catch((err) => console.error('Database connection fail:', err.message));

let razorpayInstance = null;
try {
  razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_1234567890',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'placeholder',
  });
} catch (err) {
  console.log('Razorpay setup skip ho gaya:', err.message);
}

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidPhone = (phone) => /^[6-9]\d{9}$/.test(phone);
const isStrongPassword = (password) => typeof password === 'string' && password.length >= 6;
const isPositiveNumber = (value) => typeof value === 'number' && value > 0;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'member', 'supplier', 'customer'], required: true },
    supplierDetails: {
      businessName: { type: String, trim: true },
      gstNumber: { type: String, trim: true },
      address: { type: String, trim: true },
      isVerified: { type: Boolean, default: false },
      bankDetails: {
        accountHolderName: String,
        accountNumber: String,
        ifscCode: String,
      },
    },
    address: { street: String, city: String, state: String, pincode: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

const productSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true },
    images: [{ type: String }],
    supplierSuggestedPrice: { type: Number, required: true },
    finalPrice: { type: Number, default: null },
    sellingPrice: { type: Number, default: null },
    stock: { type: Number, default: 0, min: 0 },
    gstRate: { type: Number, default: 18, enum: [0, 5, 12, 18, 28] },
    hsnCode: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.index({ status: 1, isActive: 1 });
productSchema.index({ supplier: 1 });
productSchema.index({ category: 1 });

const Product = mongoose.model('Product', productSchema);

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  quantity: { type: Number, required: true, min: 1 },
  priceAtOrder: { type: Number, required: true },
  supplierPayoutAmount: { type: Number, required: true },
  gstRate: { type: Number, default: 18 },
  hsnCode: { type: String, default: '' },
  taxableAmount: { type: Number, default: 0 },
  gstAmount: { type: Number, default: 0 },
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    invoiceNumber: { type: String },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [orderItemSchema],
    totalAmount: { type: Number, required: true },
    totalGST: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: ['prepaid', 'cod'], required: true },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    razorpay: { orderId: String, paymentId: String, signature: String },
    deliveryAddress: { street: String, city: String, state: String, pincode: String },
    status: {
      type: String,
      enum: [
        'placed', 'supplier_notified', 'received_at_warehouse',
        'packed', 'out_for_delivery', 'delivered', 'cancelled',
      ],
      default: 'placed',
    },
    settlement: {
      isSettled: { type: Boolean, default: false },
      settledAt: { type: Date },
      settlementDueDate: { type: Date },
    },
  },
  { timestamps: true }
);

orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ status: 1, 'settlement.isSettled': 1 });
orderSchema.index({ orderNumber: 1 });

const Order = mongoose.model('Order', orderSchema);

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
      return next();
    } catch (error) {
      return res.status(401).json({ message: 'Token invalid hai, dobara login karo' });
    }
  }
  return res.status(401).json({ message: 'Login zaroori hai' });
};

const authorize = (...allowedRoles) => (req, res, next) => {
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: `Aapko (${req.user.role}) is action ki permission nahi hai` });
  }
  next();
};

const generateToken = (userId) => jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
const generateOrderNumber = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${date}-${random}`;
};

app.post('/api/auth/supplier/register', authLimiter, async (req, res) => {
  try {
    const { name, email, phone, password, businessName, gstNumber, address } = req.body;
    if (!name || !email || !phone || !password || !businessName || !gstNumber || !address) {
      return res.status(400).json({ message: 'Sab fields bharna zaroori hai' });
    }
    if (!isValidEmail(email)) return res.status(400).json({ message: 'Email sahi format me nahi hai' });
    if (!isValidPhone(phone)) return res.status(400).json({ message: 'Phone number 10 digit ka aur sahi hona chahiye' });
    if (!isStrongPassword(password)) return res.status(400).json({ message: 'Password kam se kam 6 characters ka hona chahiye' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Ye email pehle se register hai' });

    const supplier = await User.create({
      name, email, phone, password, role: 'supplier',
      supplierDetails: { businessName, gstNumber, address, isVerified: false },
    });

    res.status(201).json({
      message: 'Register ho gaya. Aapka account admin verify karega, tab aap product add kar payenge.',
      supplierId: supplier._id,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/auth/customer/register', authLimiter, async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: 'Sab fields bharna zaroori hai' });
    }
    if (!isValidEmail(email)) return res.status(400).json({ message: 'Email sahi format me nahi hai' });
    if (!isValidPhone(phone)) return res.status(400).json({ message: 'Phone number 10 digit ka aur sahi hona chahiye' });
    if (!isStrongPassword(password)) return res.status(400).json({ message: 'Password kam se kam 6 characters ka hona chahiye' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Ye email pehle se register hai' });

    const customer = await User.create({ name, email, phone, password, role: 'customer' });
    res.status(201).json({ token: generateToken(customer._id), user: { id: customer._id, name: customer.name, role: customer.role } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Email ya password galat hai' });
    }
    if (user.role === 'supplier' && !user.supplierDetails.isVerified) {
      return res.status(403).json({ message: 'Aapka account abhi verify nahi hua hai. Admin approval ka wait karein.' });
    }
    res.json({ token: generateToken(user._id), user: { id: user._id, name: user.name, role: user.role } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/auth/me', protect, async (req, res) => {
  res.json({ id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role });
});

app.post('/api/products', protect, authorize('supplier'), async (req, res) => {
  try {
    const { name, description, category, images, supplierSuggestedPrice, stock, gstRate, hsnCode } = req.body;
    if (!name || !supplierSuggestedPrice) return res.status(400).json({ message: 'Product naam aur price dena zaroori hai' });
    if (!isPositiveNumber(supplierSuggestedPrice)) return res.status(400).json({ message: 'Price 0 se zyada hona chahiye' });
    if (stock !== undefined && stock < 0) return res.status(400).json({ message: 'Stock negative nahi ho sakta' });

    const product = await Product.create({
      supplier: req.user._id, name, description, category, images,
      supplierSuggestedPrice, stock, gstRate: gstRate ?? 18, hsnCode: hsnCode || '', status: 'pending',
    });
    res.status(201).json({ message: 'Product add ho gaya, admin/member approval ka wait hai', product });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/products/my-products', protect, authorize('supplier'), async (req, res) => {
  const products = await Product.find({ supplier: req.user._id }).sort({ createdAt: -1 });
  res.json(products);
});

app.get('/api/products/pending', protect, authorize('admin', 'member'), async (req, res) => {
  const products = await Product.find({ status: 'pending' }).populate('supplier', 'name supplierDetails.businessName');
  res.json(products);
});

app.put('/api/products/:id/approve', protect, authorize('admin', 'member'), async (req, res) => {
  try {
    const { finalPrice, sellingPrice } = req.body;
    if (!finalPrice || !sellingPrice) return res.status(400).json({ message: 'finalPrice aur sellingPrice dono dena zaroori hai' });
    if (sellingPrice < finalPrice) return res.status(400).json({ message: 'Selling price, final price se kam nahi ho sakta' });

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { finalPrice, sellingPrice, status: 'approved', approvedBy: req.user._id, approvedAt: new Date() },
      { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product nahi mila' });
    res.json({ message: 'Product approve ho gaya, ab Customer App pe live hai', product });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/products/:id/reject', protect, authorize('admin', 'member'), async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
  res.json({ message: 'Product reject kar diya', product });
});

app.get('/api/products', async (req, res) => {
  const products = await Product.find({ status: 'approved', isActive: true }).select('-supplierSuggestedPrice -finalPrice -supplier');
  res.json(products);
});

app.post('/api/orders', protect, authorize('customer'), async (req, res) => {
  try {
    const { items, paymentMethod, deliveryAddress } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ message: 'Order me kam se kam ek product hona chahiye' });

    let totalAmount = 0;
    let totalGST = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product || product.status !== 'approved') return res.status(400).json({ message: `Product available nahi hai: ${item.productId}` });
      if (product.stock < item.quantity) return res.status(400).json({ message: `${product.name} me stock kam hai` });

      const lineTotal = product.sellingPrice * item.quantity;
      const taxableAmount = +(lineTotal / (1 + product.gstRate / 100)).toFixed(2);
      const gstAmount = +(lineTotal - taxableAmount).toFixed(2);

      orderItems.push({
        product: product._id, supplier: product.supplier, quantity: item.quantity,
        priceAtOrder: product.sellingPrice, supplierPayoutAmount: product.finalPrice * item.quantity,
        gstRate: product.gstRate, hsnCode: product.hsnCode, taxableAmount, gstAmount,
      });

      totalAmount += lineTotal;
      totalGST += gstAmount;
      product.stock -= item.quantity;
      await product.save();
    }

    const orderNumber = generateOrderNumber();
    const order = await Order.create({
      orderNumber, invoiceNumber: `INV-${orderNumber}`, customer: req.user._id, items: orderItems,
      totalAmount, totalGST: +totalGST.toFixed(2), paymentMethod, paymentStatus: 'pending',
      deliveryAddress, status: 'placed',
    });

    res.status(201).json({ message: 'Order place ho gaya', order });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/orders/my-orders', protect, authorize('customer'), async (req, res) => {
  const orders = await Order.find({ customer: req.user._id }).sort({ createdAt: -1 });
  res.json(orders);
});

app.get('/api/orders/supplier-orders', protect, authorize('supplier'), async (req, res) => {
  const orders = await Order.find({ 'items.supplier': req.user._id }).sort({ createdAt: -1 });
  res.json(orders);
});

app.get('/api/orders', protect, authorize('admin', 'member'), async (req, res) => {
  const orders = await Order.find().populate('customer', 'name phone').sort({ createdAt: -1 });
  res.json(orders);
});

app.put('/api/orders/:id/status', protect, authorize('admin', 'member'), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['supplier_notified', 'received_at_warehouse', 'packed', 'out_for_delivery', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    const updateData = { status };
    if (status === 'delivered') {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);
      updateData['settlement.settlementDueDate'] = dueDate;
      const order = await Order.findById(req.params.id);
      if (order.paymentMethod === 'cod') updateData.paymentStatus = 'paid';
    }

    const order = await Order.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!order) return res.status(404).json({ message: 'Order nahi mila' });
    res.json({ message: `Order status "${status}" ho gaya`, order });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/orders/settlements/due', protect, authorize('admin', 'member'), async (req, res) => {
  const orders = await Order.find({
    status: 'delivered', 'settlement.isSettled': false, 'settlement.settlementDueDate': { $lte: new Date() },
  }).populate('items.supplier', 'name supplierDetails.businessName supplierDetails.bankDetails');
  res.json(orders);
});

app.put('/api/orders/:id/settle', protect, authorize('admin', 'member'), async (req, res) => {
  const order = await Order.findByIdAndUpdate(
    req.params.id,
    { 'settlement.isSettled': true, 'settlement.settledAt': new Date() },
    { new: true }
  );
  if (!order) return res.status(404).json({ message: 'Order nahi mila' });
  res.json({ message: 'Settlement complete — supplier ko payout mark kar diya', order });
});

app.get('/api/orders/gst-report', protect, authorize('admin', 'member'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ message: 'startDate aur endDate dena zaroori hai' });

    const orders = await Order.find({
      createdAt: { $gte: new Date(startDate), $lte: new Date(endDate + 'T23:59:59') },
      status: { $ne: 'cancelled' },
    });

    const rateWiseSummary = {};
    let totalTaxableAmount = 0, totalGSTCollected = 0, totalSales = 0;

    orders.forEach((order) => {
      totalSales += order.totalAmount;
      totalGSTCollected += order.totalGST;
      order.items.forEach((item) => {
        const rate = item.gstRate;
        if (!rateWiseSummary[rate]) rateWiseSummary[rate] = { taxableAmount: 0, gstAmount: 0 };
        rateWiseSummary[rate].taxableAmount += item.taxableAmount;
        rateWiseSummary[rate].gstAmount += item.gstAmount;
        totalTaxableAmount += item.taxableAmount;
      });
    });

    res.json({
      period: { startDate, endDate }, totalOrders: orders.length,
      totalSales: +totalSales.toFixed(2), totalTaxableAmount: +totalTaxableAmount.toFixed(2),
      totalGSTCollected: +totalGSTCollected.toFixed(2), rateWiseSummary,
      note: 'Ye summary reference ke liye hai. Final return file karte waqt apne CA/accountant se verify zaroor karwa lena.',
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/orders/:id/invoice', protect, authorize('admin', 'member'), async (req, res) => {
  const order = await Order.findById(req.params.id).populate('customer', 'name email phone address').populate('items.product', 'name');
  if (!order) return res.status(404).json({ message: 'Order nahi mila' });

  res.json({
    invoiceNumber: order.invoiceNumber, invoiceDate: order.createdAt, customer: order.customer,
    items: order.items.map((item) => ({
      productName: item.product?.name, hsnCode: item.hsnCode, quantity: item.quantity,
      rate: item.priceAtOrder, taxableAmount: item.taxableAmount, gstRate: item.gstRate,
      gstAmount: item.gstAmount, total: item.priceAtOrder * item.quantity,
    })),
    totalTaxableAmount: order.items.reduce((s, i) => s + i.taxableAmount, 0),
    totalGST: order.totalGST, grandTotal: order.totalAmount,
  });
});

app.post('/api/admin/members', protect, authorize('admin'), async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Ye email pehle se register hai' });

    const member = await User.create({ name, email, phone, password, role: 'member' });

    res.status(201).json({ message: 'Member add ho gaya', member: { id: member._id, name: member.name } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/members', protect, authorize('admin'), async (req, res) => {
  const members = await User.find({ role: 'member' }).select('-password');
  res.json(members);
});

app.get('/api/admin/suppliers/pending', protect, authorize('admin', 'member'), async (req, res) => {
  const suppliers = await User.find({ role: 'supplier', 'supplierDetails.isVerified': false }).select('-password');
  res.json(suppliers);
});

app.put('/api/admin/suppliers/:id/verify', protect, authorize('admin', 'member'), async (req, res) => {
  const supplier = await User.findByIdAndUpdate(req.params.id, { 'supplierDetails.isVerified': true }, { new: true }).select('-password');
  if (!supplier) return res.status(404).json({ message: 'Supplier nahi mila' });
  res.json({ message: 'Supplier verify ho gaya, ab wo login aur product add kar sakta hai', supplier });
});

app.post('/api/payments/create-razorpay-order/:orderId', protect, authorize('customer'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order nahi mila' });
    if (order.customer.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Ye order aapka nahi hai' });
    if (order.paymentStatus === 'paid') return res.status(400).json({ message: 'Ye order already paid hai' });

    const razorpayOrder = await razorpayInstance.orders.create({
      amount: Math.round(order.totalAmount * 100), currency: 'INR', receipt: order.orderNumber,
    });

    order.razorpay.orderId = razorpayOrder.id;
    await order.save();

    res.json({ razorpayOrderId: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency, key: process.env.RAZORPAY_KEY_ID });
  } catch (error) {
    res.status(500).json({ message: 'Payment start nahi ho paya: ' + error.message });
  }
});

app.post('/api/payments/verify', protect, authorize('customer'), async (req, res) => {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');

    if (expectedSignature !== razorpay_signature) return res.status(400).json({ message: 'Payment verify nahi hui — signature match nahi hua' });

    const order = await Order.findByIdAndUpdate(
      orderId,
      { paymentStatus: 'paid', 'razorpay.paymentId': razorpay_payment_id, 'razorpay.signature': razorpay_signature },
      { new: true }
    );
    res.json({ message: 'Payment successful', order });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

function startSettlementReminder() {
  cron.schedule('0 9 * * *', async () => {
    try {
      const dueOrders = await Order.find({
        status: 'delivered', 'settlement.isSettled': false, 'settlement.settlementDueDate': { $lte: new Date() },
      });
      if (dueOrders.length > 0) {
        console.log(`[Settlement Reminder] ${dueOrders.length} order(s) ka payout due hai:`);
        dueOrders.forEach((o) => console.log(` - ${o.orderNumber}: ₹${o.totalAmount}`));
      } else {
        console.log('[Settlement Reminder] Aaj koi payout due nahi hai');
      }
    } catch (error) {
      console.error('[Settlement Reminder] Error:', error.message);
    }
  });
  console.log('Settlement reminder cron job start ho gaya (roz 9 AM check karega)');
}
app.get('/setup-first-admin', async (req, res) => {
  try {
    const secretKey = req.query.key;
    if (secretKey !== 'dukaan786setup') {
      return res.status(403).json({ message: 'Galat key' });
    }
    const existing = await User.findOne({ role: 'admin' });
    if (existing) {
      return res.json({ message: 'Admin already ban chuka hai', email: existing.email });
    }
    const admin = await User.create({
      name: 'Admin', email: 'admin@dukaan.com', phone: '9999999999',
      password: 'Admin@786', role: 'admin',
    });
    res.json({ message: 'Admin ban gaya! Email: admin@dukaan.com, Password: Admin@786', admin: admin.email });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
app.get('/', (req, res) => res.json({ message: 'Marketplace API chal raha hai' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server chal raha hai port ${PORT} par`);
  startSettlementReminder();
});
  
