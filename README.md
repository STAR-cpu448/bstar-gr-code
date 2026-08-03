# QR Image Server

This project lets you upload an image and then generates a QR code that points to the uploaded image URL.

## How it works

- Upload an image from the browser.
- The server saves the image under `uploads/`.
- The app generates a QR code for the image access URL.
- Scan the QR code to open the uploaded image online.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open your browser:

```text
http://localhost:3000
```

## Keep it online

To keep this available online all the time, deploy to a hosting platform such as:

- Vercel
- Render
- Railway
- Fly.io
- Heroku

Just point the platform to this repository and use the default `npm start` command.

## Notes

- Uploaded images are stored in `uploads/`.
- The generated QR code points to `https://<your-host>/image/<filename>`.
- For long-term availability, deploy the app on a server or cloud platform, not just your local machine.
