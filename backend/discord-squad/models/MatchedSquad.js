const mongoose = require('mongoose');

const MatchedSquadSchema = new mongoose.Schema({
  concertId: {
    type: String,
    required: true,
  },
  members: [
    {
      type: String, // wallet addresses
    },
  ],
  groupVibe: {
    type: String, // AI-generated title, e.g. "The Mosh Pit Crew"
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('MatchedSquad', MatchedSquadSchema);
