# WEBCODE (fresh start)

Minimal app to upload an image and generate a QR that points at the hosted image.

Run locally:

1. npm install
2. npm start

Note: This is a fresh scaffold with a simple mock payment flow. Set `PAYSTACK_SECRET` and `PAYSTACK_PUBLIC_KEY` to integrate a real Paystack gateway.

Deploy to Render: add the environment variables in your Render service settings or update `render.yaml` with secret values, then connect the repo to Render. Webhook URL for Paystack should be:

	https://<your-render-url>/api/payments/webhook

