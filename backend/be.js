require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');

// วิธีแก้ปัญหาสำหรับ 'fetch is not a function'
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server and integrate Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ENV variables
const {
    PORT,
    MONGO_URL,
    LAT,
    LON,
    POLL_INTERVAL_SECONDS,
    API_KEY
} = process.env;

// MongoDB connect
mongoose.connect(MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

// Weather Schema
const WeatherSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    temperature: Number,
    windspeed: Number,
    winddirection: Number,
    weathercode: Number,
    raw: Object
});
const Weather = mongoose.model('Weather', WeatherSchema);

// Polling function using OpenWeatherMap API
async function fetchAndSaveAndEmit(lat, lon, apiKey) {
    try {
        if (!lat || !lon || !apiKey) {
            throw new Error('Missing LAT, LON, or API_KEY in environment variables.');
        }

        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;

        const res = await fetch(url);
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Weather API error ${res.status}: ${errorText}`);
        }

        const data = await res.json();
        
        const doc = new Weather({
            timestamp: new Date(),
            temperature: data.main?.temp,
            windspeed: data.wind?.speed,
            winddirection: data.wind?.deg,
            weathercode: data.weather?.[0]?.id,
            raw: data
        });

        await doc.save();
        console.log('Saved weather at', doc.timestamp.toISOString(), 'temp:', doc.temperature);

        // Emit latest data to all connected clients
        io.emit('weather_update', doc);

    } catch (err) {
        console.error('fetchAndSaveAndEmit error:', err.message);
    }
}

// Run once, then schedule interval
const seconds = Number(POLL_INTERVAL_SECONDS) || 60; 
const lat = LAT || '13.7563';
const lon = LON || '100.5018';
const apiKey = API_KEY;

if (isNaN(seconds) || seconds <= 0) {
    throw new Error('Invalid POLL_INTERVAL_SECONDS');
}

fetchAndSaveAndEmit(lat, lon, apiKey);
setInterval(() => fetchAndSaveAndEmit(lat, lon, apiKey), seconds * 1000);

// Health check (ยังคงมีเพื่อให้สามารถตรวจสอบสถานะเซิร์ฟเวอร์ได้)
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date() }));

// Start server
const port = Number(PORT) || 5000;
server.listen(port, err => {
    if (err) return console.error(err);
    console.log(`Backend listening on http://localhost:${port}`);
});
