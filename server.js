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

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'not_configured',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'not_configured',
});

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
      { finalPr
