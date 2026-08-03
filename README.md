# WEBCODE — QR Image Server

WEBCODE lets you upload an image and then generates a QR code that points to the uploaded image URL.

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

This app is a Node.js server and is best deployed to a service that supports backend Node apps.

### Deploy to Render

1. Go to https://render.com and sign in.
2. Click **New** → **Web Service**.
3. Connect your GitHub account and select the `STAR-cpu448/bstar-gr-code` repository.
4. Set the branch to `main`.
5. Set the build command to:

```bash
npm install
```

6. Set the start command to:

```bash
npm start
```

7. Create the service.

Render will build the app and provide a public URL where your image upload + QR generator will run.

### Notes

- Uploaded images are stored in `uploads/` on the server filesystem.
- The generated QR code points to `https://<your-host>/image/<filename>`.
- For long-term availability, keep the Render service running.

## Alternative hosts

- Railway, Heroku, or Fly.io also support this Node.js app.


- Uploaded images are stored in `uploads/`.
- The generated QR code points to `https://<your-host>/image/<filename>`.
- For long-term availability, deploy the app on a server or cloud platform, not just your local machine.
