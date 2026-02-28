const mongoose = require('mongoose');

const SquadSchema = new mongoose.Schema({
  concertId: {
    type: String,
    required: true,
    index: true
  },
  concertName: {
    type: String,
    required: true
  },
  channelId: {
    type: String,
    required: true,
    unique: true
  },
  channelName: {
    type: String
  },
  inviteUrl: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Squad', SquadSchema);
