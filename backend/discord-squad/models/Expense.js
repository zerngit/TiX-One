const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema({
  channelId: {
    type: String,
    required: true,
    index: true
  },
  payer: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Expense', ExpenseSchema);
