# Lemon Squeezy AI credit top-ups

This guide covers the card-payment integration in Settings → Payment. Customers can also pay with Solana and Phantom. Lemon Squeezy handles card details in its checkout overlay; the app adds credits after receiving and verifying the payment webhook.

## Pricing

- The available top-up selections are S$5, S$10, S$15, S$25, S$50 and S$100. Customers can switch the display to an estimated amount in Chinese yuan.
- Card checkout selects the variant matching the exact SGD amount. The store currency must be SGD. The CNY toggle changes the estimated display amount only. Lemon Squeezy displays SGD but converts payments to USD for processing using its own exchange rate; taxes and the final card conversion can differ.
- Daily ECB reference rates convert the selected SGD amount to a USD reference value, rounded to cents. Each reference US cent buys 2,500 AI credits, preserving the rate of 7,500,000 credits for US$30. The promised credit quantity is fixed when checkout starts and is not recalculated from Lemon Squeezy's settlement exchange rate. Taxes do not buy additional credits. Solana top-ups also use this reference value.
- If reference rates are unavailable or outdated, new top-up selections are unavailable. If a rate changes before checkout, the app asks the customer to refresh the price.

## 1. Prepare an isolated test environment

Use a separate test application and Supabase database. Apply the pending database migrations in filename order through `supabase/migrations/0046_lemon_sgd_variants.sql`. Migration `0044_chat_only_onboarding.sql` is also needed for the chat-only registration option.

Migration `0046` adds order-currency verification and refund accounting for SGD orders. Apply it before deploying the six-variant integration. Existing USD orders and their refunds remain supported.

The test database must have the app's usual Supabase configuration, including the server-side service role key. The deployed test app must be reachable over HTTPS so Lemon Squeezy can deliver webhooks. A local app needs a publicly accessible tunnel for webhook delivery.

**Do not enable test credits on a production database.** A successful simulated payment adds usable AI credits to the database connected to the application.

## 2. Set up the Lemon Squeezy test product

1. Switch the Lemon Squeezy dashboard to **test mode**.
2. Set the store currency to **SGD** in Settings → General.
3. Create and publish six **one-time**, **standard-priced** variants at **S$5, S$10, S$15, S$25, S$50 and S$100**, with tax-exclusive pricing. They can belong to one product or separate products in the same store. The app uses their configured prices directly.
4. Do not enable discounts or quantity changes for the checkout.
5. Copy the store ID from Settings → Stores. Copy each test variant's numeric ID using its dropdown menu → Copy ID. Create a test-mode API key and keep it private.

The server validates the store, product, variant, base price and test mode before creating a checkout. A mismatch prevents checkout from starting.

## 3. Configure the test app

Set these environment variables on the server, then restart or redeploy the test app:

```env
LEMONSQUEEZY_API_KEY=your_api_key
LEMONSQUEEZY_STORE_ID=515624
LEMONSQUEEZY_VARIANT_ID_SGD_5=your_5_sgd_test_variant_id
LEMONSQUEEZY_VARIANT_ID_SGD_10=your_10_sgd_test_variant_id
LEMONSQUEEZY_VARIANT_ID_SGD_15=your_15_sgd_test_variant_id
LEMONSQUEEZY_VARIANT_ID_SGD_25=your_25_sgd_test_variant_id
LEMONSQUEEZY_VARIANT_ID_SGD_50=your_50_sgd_test_variant_id
LEMONSQUEEZY_VARIANT_ID_SGD_100=your_100_sgd_test_variant_id
LEMONSQUEEZY_WEBHOOK_SECRET=your_webhook_signing_secret
LEMONSQUEEZY_TEST_MODE=true
LEMONSQUEEZY_ALLOW_TEST_CREDITS=true
```

Replace each variant placeholder with a distinct numeric ID. The former single `LEMONSQUEEZY_VARIANT_ID` variable is no longer used for new checkouts.

Use the webhook secret generated for you, or generate another secret with `openssl rand -hex 20`. The secret must be 6–40 characters. Do not commit the actual API key or webhook secret to Git. The test-credit flag must be set only on an isolated test database; otherwise test orders are ignored and test card checkout is unavailable.

## 4. Register the webhook

In the Lemon Squeezy test dashboard, create a webhook with the following destination, replacing the domain with your public test app's domain:

```text
https://YOUR-TEST-APP-DOMAIN/api/billing/lemon/webhook
```

Set its signing secret to the same value as `LEMONSQUEEZY_WEBHOOK_SECRET` and subscribe to:

- `order_created`
- `order_refunded`

Test-mode and live-mode webhook configurations must each point to their corresponding environment and use its configured secret.

## 5. Make a test purchase

1. Sign in to the test app and open **Settings → Payment**.
2. Select an amount and **Card & more**, then open checkout. Check that the SGD amount and promised credit quantity match your selection.
3. Complete checkout using [Lemon Squeezy's test payment details](https://docs.lemonsqueezy.com/help/getting-started/test-mode).
4. Check the webhook delivery in Lemon Squeezy. Once the signed webhook has been processed, confirm that the AI credit balance and payment history have updated.
5. Test a refund and confirm that the credits are adjusted. Full and partial refunds reduce the granted credits in proportion to the amount refunded, including tax. Previously spent or transferred credits can leave an account with a deficit against future top-ups.

An overlay success message alone does not add credits. The server must verify the webhook and match it to a checkout intent. Repeated webhook deliveries do not grant credits twice.

## Going live

After testing, configure six corresponding live variants, a live-mode API key and a live webhook for the live app. Live variants receive different IDs; update all six mappings. Apply pending migrations to the live database, set `LEMONSQUEEZY_TEST_MODE=false`, and **remove** `LEMONSQUEEZY_ALLOW_TEST_CREDITS` from the live environment. Confirm the live webhook is receiving events and monitor failed deliveries.

Finish or reconcile outstanding checkouts before rotating the webhook secret: changing it invalidates the proof attached to outstanding checkout intents. Disputes and chargebacks require separate operational review; the integration processes order creation and refunds.

## Troubleshooting

- **Card payment unavailable:** Check the environment variables, test-credit flag and server restart. In test mode, make sure the app is connected to the isolated test database.
- **Checkout will not start:** Check that the store uses SGD, that all six ID variables are present and distinct, and that each variant has its exact matching SGD price. Products must be published, one-time and standard-priced. Check that the variant belongs to the configured store and matches the selected test or live mode.
- **Payment completed but credits did not appear:** Check delivery of `order_created`, the endpoint URL, signing secret and server logs. The order must match the original checkout intent and expected price. Correct the issue before resending a failed webhook; do not create a new checkout to replay an old order.
- **Exchange rates unavailable:** The server needs access to the Frankfurter exchange-rate API. The app fails closed when the daily reference rates are missing or stale.

For local verification, run `node --test tests/credit-pricing.test.cjs tests/lemon-api.test.cjs tests/lemon-credits.test.cjs`. These automated checks do not replace an actual test-mode checkout and webhook delivery.

References: [Lemon Squeezy test mode](https://docs.lemonsqueezy.com/help/getting-started/test-mode), [checkout overlays](https://docs.lemonsqueezy.com/help/lemonjs/opening-overlays), and [store currencies](https://docs.lemonsqueezy.com/help/payments/currencies).
