const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  senderId: { type: String, required: true },
  message: { type: String },
  isPrivate: { type: Boolean, default: false },
  to: { type: String, default: null }, // recipient socket id if private
  file: { filename: String, url: String, mimetype: String, size: Number },
  deliveredTo: [{ type: String }], // array of socketIds that have delivered
  readBy: [{ type: String }], // array of socketIds that have read
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Message', MessageSchema);
