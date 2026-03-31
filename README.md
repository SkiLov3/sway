# Sway - Powerlifting Meet Management App

Sway is a minimal, local-first web application designed to help you run powerlifting meets straight from your laptop. It connects devices over your local network to provide real-time scoreboards, referee light systems, and TV display views.

![SWAY Preview](https://via.placeholder.com/800x400.png?text=Sway+Powerlifting+Meet+App)

## Features

- **Local Network Sync**: Run the server on your laptop and access referee, display, and scoring views from phones, tablets, or TVs connected to the same Wi-Fi. No internet required.
- **TV Display Mode**: HDMI-optimized full-screen view with a real-time plate loader visualization, current lifter info, and large referee lights.
- **Referee System**: Mobile-friendly referee pages for the Left, Head, and Right judges to cast white/red lights. The system auto-calculates the final result based on majority vote.
- **Meet Configuration**: Built-in division presets for USAPL, USPA, and IPF. Add custom divisions, weight classes, and easily import lifters via CSV.
- **Live Scoring Board**: Operator dashboard showing lifting order, flight tracking, and a 60-second competition timer.
- **Automated Results**: Real-time results page showing placing, totals, and color-coded attempt tables, exportable to CSV.
- **Rock Solid Integrity**: Integrated server-side broadcasting for real-time sync, input validation for body weights and attempt weights, and automated majority-vote calculation.

## Getting Started

You do not need an active internet connection to run the meet, but you must have Node.js installed on the host machine.

### Option 1: Run with Node.js (Recommended for Local Use)

1. Clone the repository and navigate to the project directory:
   ```bash
   git clone https://github.com/SkiLov3/sway.git
   cd sway
   ```
2. Install dependencies (including development dependencies for testing):
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```

4. Open `http://localhost:3000` in your browser.

The app will display your local network IP (e.g., `http://192.168.1.100:3000`) so you can access the referee and display pages from other devices on your Wi-Fi.

## Testing

Sway includes a comprehensive test suite using **Jest** and **Supertest** to ensure scoring accuracy and API reliability.

### Run all tests:
```bash
npm test
```

### Test Coverage:
- **Scoring Logic**: Validates DOTS points calculation for men, women, and non-binary lifters.
- **Meets API**: Ensures meet creation, updates, and state management work as expected.
- **Lifters API**: Verifies lifter registration, input validation, and CSV import logic.
- **Attempts API**: Tests real-time weight setting, referee voting, and majority-rule results.

## Data Persistence

If you prefer using Docker to avoid installing Node.js:

1. Clone the repository:
   ```bash
   git clone https://github.com/SkiLov3/sway.git
   cd sway
   ```
2. Start the container:
   ```bash
   docker-compose up -build
   ```
3. Open `http://localhost:3000` in your browser.

*(Note: The database is persisted in the `./data` directory on the host when using Docker.)*

## Data Persistence

Sway uses an SQLite database (`better-sqlite3`). Once the server is started, a `data/sway.db` file is automatically created. All meet configurations, lifter data, and attempt results are saved immediately. You can safely stop and restart your laptop, and your meet data will persist.

## Contributing

Pull requests are welcome! If you find a bug or want to suggest a feature, please open an issue first.

## License

MIT
