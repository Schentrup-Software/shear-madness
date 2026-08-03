# Shear Madness 🎮✂️

A real-time tournament management application for Cornhole competitions. Built with React Router 7, TypeScript, and PocketBase, Shear Madness makes it easy to organize and run tournaments with QR code player sign-ups and live bracket updates.

**🚀 [Try the live app here!](https://shear-madness.schentrupsoftware.com/)**

## ✨ Features

- 🎯 **Tournament Management**: Create and manage Cornhole tournaments with ease
- 📱 **QR Code Sign-ups**: Generate QR codes for quick player registration
- � **Real-time Updates**: Live bracket updates as matches progress using PocketBase real-time subscriptions
- 🏆 **Tournament Brackets**: Visual bracket display showing match progression
- 💬 **Google Chat Notifications**: Optionally DM players the moment their match starts — see [docs/google-chat-setup.md](docs/google-chat-setup.md)
- 🔒 **TypeScript**: Full type safety throughout the application
- � **TailwindCSS**: Modern, responsive styling
- �️ **PocketBase Backend**: Lightweight, real-time database with built-in authentication

## 🎮 How It Works

1. **Create a Tournament**: Set up a new Cornhole tournament
2. **Player Sign-up**: Share the QR code for players to join via their mobile devices
3. **Start Tournament**: Once all players are registered, initialize the bracket
4. **Play Matches**: Update match results in real-time as players compete
5. **Track Progress**: Watch the bracket fill out as winners advance

## 🚀 Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

> **Note**: The local app points to the running production instace of pocketbase. Configure the PocketBase connection in `app/backend/pocketbaseClient.ts` if you want to use a local version instead.

## 🛠️ Tech Stack

- **Frontend**: React 19, React Router 7, TypeScript
- **Styling**: TailwindCSS
- **Backend**: PocketBase (real-time database)
- **Build Tool**: Vite
- **QR Codes**: qrcode.react
- **Deployment**: Docker, containerized deployment

## 📚 Project Structure

- `app/routes/` - Application pages (home, tournament, bracket, signup, player)
- `app/backend/` - Backend API integration and PocketBase client
- `app/welcome/` - Landing page components
- `public/` - Static assets

## 🎨 Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

## 📝 License

This project is open source and available under the MIT License.

---

Built with ❤️ by Schentrup Software using React Router | [Visit Live App](https://shear-madness.schentrupsoftware.com/)
