const mongoose = require('mongoose');

const AttendeeSchema = new mongoose.Schema({
  walletAddress: {
    type: String,
    required: true,
  },
  concertId: {
    type: String,
    required: true,
  },
  bio: {
    type: String,
    required: true,
    maxLength: 200,
  },
  isMatched: {
    type: Boolean,
    default: false,
  },
  squadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MatchedSquad',
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// One entry per wallet per concert
AttendeeSchema.index({ walletAddress: 1, concertId: 1 }, { unique: true });

module.exports = mongoose.model('Attendee', AttendeeSchema);
