// ============================================================
// POORA BACKEND EK HI FILE ME — taaki GitHub pe upload aasan ho
// (normally ye alag-alag files me hota hai, lekin upload ke
// liye ek file me combine kar diya hai)
// ============================================================

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
const PDFDocument = require('pdfkit');

const app = express();

// ============================================================
// SECURITY SETUP
// ============================================================
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

// ============================================================
// DATABASE CONNECT
// ============================================================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('Database se connect ho gaya'))
  .catch((err) => console.error('Database connection fail:', err.message));

// ============================================================
// RAZORPAY SETUP
// ============================================================
let razorpayInstance = null;
try {
  razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_1234567890',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'placeholder',
  });
} catch (err) {
  console.log('Razorpay setup skip ho gaya:', err.message);
}

// ============================================================
// VALIDATION HELPERS
// ============================================================
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidPhone = (phone) => /^[6-9]\d{9}$/.test(phone);
const isStrongPassword = (password) => typeof password === 'string' && password.length >= 6;
const isPositiveNumber = (value) => typeof value === 'number' && value > 0;

// ============================================================
// MODELS (User, Product, Order)
// ============================================================

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
    addresses: [{
      label: { type: String, default: 'Home' },
      street: String, city: String, state: String, pincode: String,
      isDefault: { type: Boolean, default: false },
    }],
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    savedForLater: [{
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      quantity: { type: Number, default: 1 },
    }],
    recentlyViewed: [{
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      viewedAt: { type: Date, default: Date.now },
    }],
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
    subcategory: { type: String, trim: true },
    images: [{ type: String }],
    supplierSuggestedPrice: { type: Number, required: true },
    finalPrice: { type: Number, default: null },
    sellingPrice: { type: Number, default: null },
    stock: { type: Number, default: 0, min: 0 },
    gstRate: { type: Number, default: 18, enum: [0, 5, 12, 18, 28] },
    hsnCode: { type: String, trim: true, default: '' },
    avgRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
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
    discountAmount: { type: Number, default: 0 },
    couponCode: { type: String, default: '' },
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

// ---------- Naye Models (Coupon, Review, Notification) ----------
const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountType: { type: String, enum: ['percent', 'flat'], required: true },
    discountValue: { type: Number, required: true },
    minOrderAmount: { type: Number, default: 0 },
    maxDiscountAmount: { type: Number, default: null }, // percent wale coupon ke liye cap
    expiryDate: { type: Date, required: true },
    usageLimit: { type: Number, default: null }, // total kitni baar use ho sakta hai (null = unlimited)
    usedCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
const Coupon = mongoose.model('Coupon', couponSchema);

const reviewSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true },
  },
  { timestamps: true }
);
reviewSchema.index({ product: 1, customer: 1 }, { unique: true }); // ek customer ek product pe ek hi review de sakta hai
const Review = mongoose.model('Review', reviewSchema);

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true },
    type: { type: String, default: 'info' }, // info, order, offer
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);
const Notification = mongoose.model('Notification', notificationSchema);

// Helper — kisi user ko notification bhejne ke liye
const notifyUser = async (userId, message, type = 'info') => {
  try {
    await Notification.create({ user: userId, message, type });
  } catch (err) {
    console.error('Notification create nahi hui:', err.message);
  }
};


// ============================================================
// AUTH MIDDLEWARE
// ============================================================
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

// ============================================================
// AUTH ROUTES
// ============================================================
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

// ============================================================
// PRODUCT ROUTES
// ============================================================
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
  const { category } = req.query;
  const filter = { status: 'approved', isActive: true };
  if (category) filter.category = category;
  const products = await Product.find(filter).select('-supplierSuggestedPrice -finalPrice -supplier');
  res.json(products);
});

// ---------- Categories/Subcategories ki list ----------
app.get('/api/categories', async (req, res) => {
  const categories = await Product.distinct('category', { status: 'approved', isActive: true });
  const subcategories = await Product.distinct('subcategory', { status: 'approved', isActive: true });
  res.json({ categories: categories.filter(Boolean), subcategories: subcategories.filter(Boolean) });
});

// ---------- Ek product ka poora detail (view karne ke liye) ----------
app.get('/api/products/:id', async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, status: 'approved' }).select('-supplierSuggestedPrice -finalPrice -supplier');
  if (!product) return res.status(404).json({ message: 'Product nahi mila' });
  res.json(product);
});

// ---------- Similar products (same category) ----------
app.get('/api/products/:id/similar', async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product nahi mila' });
  const similar = await Product.find({
    category: product.category, status: 'approved', isActive: true, _id: { $ne: product._id },
  }).limit(8).select('-supplierSuggestedPrice -finalPrice -supplier');
  res.json(similar);
});

// ---------- Frequently bought together (past orders me saath kya khareeda gaya) ----------
app.get('/api/products/:id/frequently-bought-together', async (req, res) => {
  try {
    const orders = await Order.find({ 'items.product': req.params.id }).limit(50);
    const coCounts = {};
    orders.forEach((order) => {
      order.items.forEach((item) => {
        const pid = item.product.toString();
        if (pid !== req.params.id) coCounts[pid] = (coCounts[pid] || 0) + 1;
      });
    });
    const topIds = Object.entries(coCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
    const products = await Product.find({ _id: { $in: topIds }, status: 'approved' }).select('-supplierSuggestedPrice -finalPrice -supplier');
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// ORDER ROUTES
// ============================================================
app.post('/api/orders', protect, authorize('customer'), async (req, res) => {
  try {
    const { items, paymentMethod, deliveryAddress, couponCode } = req.body;
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

    // Coupon apply karna (agar diya gaya ho)
    let discountAmount = 0;
    let appliedCouponCode = '';
    if (couponCode) {
      const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
      if (coupon && coupon.expiryDate > new Date() && totalAmount >= coupon.minOrderAmount &&
          (coupon.usageLimit === null || coupon.usedCount < coupon.usageLimit)) {
        discountAmount = coupon.discountType === 'percent'
          ? +(totalAmount * (coupon.discountValue / 100)).toFixed(2)
          : coupon.discountValue;
        if (coupon.maxDiscountAmount) discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
        discountAmount = Math.min(discountAmount, totalAmount); // discount amount se zyada nahi ho sakta
        appliedCouponCode = coupon.code;
        coupon.usedCount += 1;
        await coupon.save();
      }
    }

    const orderNumber = generateOrderNumber();
    const order = await Order.create({
      orderNumber, invoiceNumber: `INV-${orderNumber}`, customer: req.user._id, items: orderItems,
      totalAmount: totalAmount - discountAmount, totalGST: +totalGST.toFixed(2),
      discountAmount, couponCode: appliedCouponCode,
      paymentMethod, paymentStatus: 'pending', deliveryAddress, status: 'placed',
    });

    // Cart me se jo order hua wo saved-for-later se hata do (agar wahan se aaya ho)
    await User.findByIdAndUpdate(req.user._id, { $pull: { savedForLater: { product: { $in: items.map(i => i.productId) } } } });

    await notifyUser(req.user._id, `Aapka order ${orderNumber} place ho gaya!`, 'order');

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
    await notifyUser(order.customer, `Aapka order ${order.orderNumber} ab "${status}" hai`, 'order');
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

// ============================================================
// ADMIN ROUTES (member management, supplier verification)
// ============================================================
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

// ============================================================
// PAYMENT ROUTES (Razorpay)
// ============================================================
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

// ============================================================
// SETTLEMENT REMINDER (roz 9 AM check karta hai)
// ============================================================
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

// ============================================================
// SERVER START
// ============================================================
// ============================================================
// WISHLIST ROUTES
// ============================================================
app.post('/api/wishlist/:productId', protect, authorize('customer'), async (req, res) => {
  const user = await User.findById(req.user._id);
  const idx = user.wishlist.findIndex((id) => id.toString() === req.params.productId);
  if (idx > -1) {
    user.wishlist.splice(idx, 1);
    await user.save();
    return res.json({ message: 'Wishlist se hata diya', inWishlist: false });
  }
  user.wishlist.push(req.params.productId);
  await user.save();
  res.json({ message: 'Wishlist me daal diya', inWishlist: true });
});

app.get('/api/wishlist', protect, authorize('customer'), async (req, res) => {
  const user = await User.findById(req.user._id).populate({
    path: 'wishlist',
    match: { status: 'approved' },
    select: '-supplierSuggestedPrice -finalPrice -supplier',
  });
  res.json(user.wishlist);
});

// ============================================================
// SAVE FOR LATER ROUTES
// ============================================================
app.post('/api/save-for-later/:productId', protect, authorize('customer'), async (req, res) => {
  const quantity = req.body.quantity || 1;
  const user = await User.findById(req.user._id);
  const existing = user.savedForLater.find((s) => s.product.toString() === req.params.productId);
  if (existing) {
    existing.quantity = quantity;
  } else {
    user.savedForLater.push({ product: req.params.productId, quantity });
  }
  await user.save();
  res.json({ message: 'Save for later me daal diya' });
});

app.get('/api/save-for-later', protect, authorize('customer'), async (req, res) => {
  const user = await User.findById(req.user._id).populate({
    path: 'savedForLater.product',
    select: '-supplierSuggestedPrice -finalPrice -supplier',
  });
  res.json(user.savedForLater);
});

app.delete('/api/save-for-later/:productId', protect, authorize('customer'), async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $pull: { savedForLater: { product: req.params.productId } } });
  res.json({ message: 'Hata diya' });
});

// ============================================================
// RECENTLY VIEWED ROUTES
// ============================================================
app.post('/api/recently-viewed/:productId', protect, authorize('customer'), async (req, res) => {
  const user = await User.findById(req.user._id);
  user.recentlyViewed = user.recentlyViewed.filter((r) => r.product.toString() !== req.params.productId);
  user.recentlyViewed.unshift({ product: req.params.productId, viewedAt: new Date() });
  user.recentlyViewed = user.recentlyViewed.slice(0, 20); // sirf last 20 rakho
  await user.save();
  res.json({ message: 'Track ho gaya' });
});

app.get('/api/recently-viewed', protect, authorize('customer'), async (req, res) => {
  const user = await User.findById(req.user._id).populate({
    path: 'recentlyViewed.product',
    select: '-supplierSuggestedPrice -finalPrice -supplier',
  });
  res.json(user.recentlyViewed.filter((r) => r.product));
});

// ============================================================
// MULTI-ADDRESS ROUTES
// ============================================================
app.post('/api/addresses', protect, authorize('customer'), async (req, res) => {
  const { label, street, city, state, pincode, isDefault } = req.body;
  const user = await User.findById(req.user._id);
  if (isDefault) user.addresses.forEach((a) => { a.isDefault = false; });
  user.addresses.push({ label, street, city, state, pincode, isDefault: isDefault || user.addresses.length === 0 });
  await user.save();
  res.json({ message: 'Address add ho gaya', addresses: user.addresses });
});

app.get('/api/addresses', protect, authorize('customer'), async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json(user.addresses);
});

app.put('/api/addresses/:addressId', protect, authorize('customer'), async (req, res) => {
  const user = await User.findById(req.user._id);
  const addr = user.addresses.id(req.params.addressId);
  if (!addr) return res.status(404).json({ message: 'Address nahi mila' });
  Object.assign(addr, req.body);
  if (req.body.isDefault) user.addresses.forEach((a) => { if (a._id.toString() !== req.params.addressId) a.isDefault = false; });
  await user.save();
  res.json({ message: 'Address update ho gaya', addresses: user.addresses });
});

app.delete('/api/addresses/:addressId', protect, authorize('customer'), async (req, res) => {
  const user = await User.findById(req.user._id);
  user.addresses.id(req.params.addressId).deleteOne();
  await user.save();
  res.json({ message: 'Address delete ho gaya', addresses: user.addresses });
});

// ============================================================
// COUPON ROUTES
// ============================================================
app.post('/api/admin/coupons', protect, authorize('admin', 'member'), async (req, res) => {
  try {
    const coupon = await Coupon.create(req.body);
    res.status(201).json({ message: 'Coupon ban gaya', coupon });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/coupons', protect, authorize('admin', 'member'), async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 });
  res.json(coupons);
});

app.put('/api/admin/coupons/:id/toggle', protect, authorize('admin', 'member'), async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) return res.status(404).json({ message: 'Coupon nahi mila' });
  coupon.isActive = !coupon.isActive;
  await coupon.save();
  res.json({ message: `Coupon ${coupon.isActive ? 'active' : 'inactive'} kar diya`, coupon });
});

app.post('/api/coupons/validate', protect, authorize('customer'), async (req, res) => {
  const { code, cartTotal } = req.body;
  const coupon = await Coupon.findOne({ code: (code || '').toUpperCase(), isActive: true });
  if (!coupon) return res.status(404).json({ message: 'Coupon valid nahi hai' });
  if (coupon.expiryDate < new Date()) return res.status(400).json({ message: 'Coupon expire ho chuka hai' });
  if (cartTotal < coupon.minOrderAmount) return res.status(400).json({ message: `Minimum order ₹${coupon.minOrderAmount} ka hona chahiye` });
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return res.status(400).json({ message: 'Coupon ki limit khatam ho gayi' });

  let discount = coupon.discountType === 'percent' ? +(cartTotal * (coupon.discountValue / 100)).toFixed(2) : coupon.discountValue;
  if (coupon.maxDiscountAmount) discount = Math.min(discount, coupon.maxDiscountAmount);
  discount = Math.min(discount, cartTotal);

  res.json({ valid: true, discount, code: coupon.code });
});

// ============================================================
// REVIEWS & RATINGS ROUTES
// ============================================================
app.post('/api/products/:id/reviews', protect, authorize('customer'), async (req, res) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ message: 'Rating 1 se 5 ke beech honi chahiye' });

    const existing = await Review.findOne({ product: req.params.id, customer: req.user._id });
    if (existing) {
      existing.rating = rating;
      existing.comment = comment;
      await existing.save();
    } else {
      await Review.create({ product: req.params.id, customer: req.user._id, rating, comment });
    }

    // Product ki average rating recalculate karo
    const reviews = await Review.find({ product: req.params.id });
    const avgRating = +(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1);
    await Product.findByIdAndUpdate(req.params.id, { avgRating, reviewCount: reviews.length });

    res.json({ message: 'Review save ho gaya', avgRating, reviewCount: reviews.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/products/:id/reviews', async (req, res) => {
  const reviews = await Review.find({ product: req.params.id }).populate('customer', 'name').sort({ createdAt: -1 });
  res.json(reviews);
});

// ============================================================
// NOTIFICATIONS ROUTES
// ============================================================
app.get('/api/notifications', protect, async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(30);
  res.json(notifications);
});

app.put('/api/notifications/:id/read', protect, async (req, res) => {
  await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
  res.json({ message: 'Read mark kar diya' });
});

app.put('/api/notifications/read-all', protect, async (req, res) => {
  await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
  res.json({ message: 'Sab read mark kar diye' });
});

// ============================================================
// INVOICE PDF DOWNLOAD
// ============================================================
app.get('/api/orders/:id/invoice-pdf', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer', 'name email phone').populate('items.product', 'name');
    if (!order) return res.status(404).json({ message: 'Order nahi mila' });

    // Sirf apna order dekh sakta hai, ya admin/member kisi ka bhi
    if (req.user.role === 'customer' && order.customer._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Ye order aapka nahi hai' });
    }

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${order.invoiceNumber}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).text('Dukaan — Invoice', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).text(`Invoice Number: ${order.invoiceNumber}`);
    doc.text(`Order Number: ${order.orderNumber}`);
    doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`);
    doc.text(`Customer: ${order.customer.name} (${order.customer.email})`);
    doc.moveDown();

    doc.fontSize(12).text('Items:', { underline: true });
    doc.moveDown(0.5);
    order.items.forEach((item) => {
      doc.fontSize(10).text(
        `${item.product?.name || 'Product'} — Qty: ${item.quantity} x ₹${item.priceAtOrder} = ₹${(item.quantity * item.priceAtOrder).toFixed(2)} (GST ${item.gstRate}%: ₹${item.gstAmount})`
      );
    });

    doc.moveDown();
    if (order.discountAmount > 0) doc.fontSize(11).text(`Discount (${order.couponCode}): -₹${order.discountAmount}`);
    doc.fontSize(11).text(`Total GST: ₹${order.totalGST}`);
    doc.fontSize(13).text(`Grand Total: ₹${order.totalAmount}`, { underline: true });
    doc.moveDown();
    doc.fontSize(9).fillColor('gray').text('Ye ek computer-generated invoice hai.');

    doc.end();
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
