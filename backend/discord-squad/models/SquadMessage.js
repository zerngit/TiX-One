const mongoose = require('mongoose');

const SquadMessageSchema = new mongoose.Schema({
  squadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MatchedSquad',
    required: true,
    index: true,
  },
  walletAddress: {
    type: String,
    required: true,
  },
  text: {
    type: String,
    required: true,
    maxLength: 500,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('SquadMessage', SquadMessageSchema);
