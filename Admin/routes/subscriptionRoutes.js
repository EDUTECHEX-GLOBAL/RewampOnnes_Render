const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');

router.get('/count', async (req, res) => {
  try {
    const count = await Subscription.countDocuments();
    res.status(200).json({ count });
  } catch (err) {
    console.error("Error fetching subscription count", err);
    res.status(500).send('Error fetching subscription count');
  }
});

// GET - Get all subscriptions — sorted, latest first (kept unbounded since this
// list tends to stay much smaller than visitors; add .limit() here too if it grows large)
router.get('/', async (req, res) => {
  try {
    const subscriptions = await Subscription.find().sort({ createdAt: -1 });
    res.status(200).json(subscriptions);
  } catch (error) {
    res.status(500).json({ message: "Error fetching subscriptions.", error });
  }
});

router.post('/', async (req, res) => {
  try {
    const { email } = req.body;

    const existingSubscription = await Subscription.findOne({ email });
    if (existingSubscription) {
      return res.status(400).json({ message: "This email is already subscribed." });
    }

    const newSubscription = new Subscription({ email });
    await newSubscription.save();
    res.status(201).json({ message: "Subscribed successfully!" });
  } catch (error) {
    res.status(500).json({ message: "Error subscribing.", error });
  }
});

module.exports = router;