# WEBCODE (fresh start)

Minimal app to upload an image and generate a QR that points at the hosted image.

Run locally:

1. npm install
2. npm start

Note: This is a fresh scaffold with a simple mock payment flow. Set `PAYSTACK_SECRET` and `PAYSTACK_PUBLIC_KEY` to integrate a real Paystack gateway.


Deploy to Render
---------------

You can deploy this repo to Render using the included `render.yaml`. The service will be created as "QX QR Code Generator" (you can change the name in `render.yaml` if you prefer).

Quick steps:

1. Push this branch to your GitHub repository (already done).
2. Open Render dashboard and create a new Web Service by connecting your GitHub repo, or let Render detect `render.yaml` and create the service automatically.
3. Confirm these settings (Render UI or `render.yaml`):
	- Environment: `Node`
	- Build command: `npm install`
	- Start command: `npm start`
	- Service name: `QX QR Code Generator` (optional)

4. Set the following environment variables in Render (Settings → Environment):
	- `PAYSTACK_SECRET` — your Paystack secret key
	- `PAYSTACK_PUBLIC_KEY` — your Paystack public key
	- `ADMIN_EMAIL` — optional admin email for bypass
	- `ADMIN_BYPASS_KEY` — optional admin bypass key
	- `DATABASE_URL` — Postgres connection string (optional; app falls back to file storage)
	- `REDIS_URL` — Redis connection string (optional)
	- `INTASEND_KEY` and `INTASEND_STK_URL` — optional IntaSend credentials
	- `SAFARICOM_CONSUMER_KEY`, `SAFARICOM_CONSUMER_SECRET`, `SAFARICOM_SHORTCODE`, `SAFARICOM_PASSKEY`, `STK_CALLBACK_URL` — optional Safaricom Daraja creds and callback URL

5. Set webhook URLs with your payment provider(s):
	- Paystack webhook: `https://<your-render-url>/api/payments/webhook`
	- Safaricom STK callback: `https://<your-render-url>/api/payments/webhook`

6. Deploy the service. Tail the Render logs and watch for `WEBCODE fresh app listening` or any startup errors.

Notes:
- If you do not provide `DATABASE_URL` or `REDIS_URL`, the app uses a local JSON fallback file stored in the machine's temp directory (ephemeral on Render). For production, provide persistent Postgres and Redis instances.
- To test without real payments, use the `/mock-pay` URL returned by `/api/payments/create`.


