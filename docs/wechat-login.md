# WeChat sign-in for 2ndBrain

This setup uses a WeChat website application, Logto's WeChat Web connector as an OpenID Connect (OIDC) bridge, and the existing Supabase Auth session flow:

`2ndBrain → Supabase Auth → Logto → WeChat → Logto → Supabase Auth → 2ndBrain`

The app's WeChat option is disabled by default. The `custom:wechat` provider name below must match exactly. Google login remains available. Logto is a separate service with its own account, plans, and availability; review its current terms and cost before choosing it. We have not verified an end-to-end login against your accounts until the credentials and registration are in place.

## 1. Create a Logto tenant and note its domain

1. Visit [Logto Cloud](https://cloud.logto.io/), sign up or log in, and follow the prompts to create a tenant named, for example, `2ndBrain`. You can instead run Logto yourself. Choose the public HTTPS domain you intend to keep; changing it later requires updating the WeChat callback domain and Supabase issuer.
2. In the tenant console, open **Connectors → Social connectors**, click **Add social connector**, and choose **WeChat (Web)**.
3. In the connector details, find its **redirect URI** or **callback URI** and note the hostname. For example, if the URI is `https://example.logto.app/some/path`, the hostname is `example.logto.app`. Enter the actual hostname from your connector as the callback domain when registering your WeChat website app. Do not use the 2ndBrain or Supabase domain unless it is also the Logto callback hostname.
4. The connector asks for a WeChat App ID and App Secret. Obtain these after registering and getting approval for the WeChat website application in step 2, then return to Logto to complete the connector.

## 2. Register the WeChat website application

1. Register and sign in at [WeChat Open Platform](https://open.weixin.qq.com/). Complete any organization, identity verification, or ownership steps required for your account. Eligibility, fees, review, and required evidence are determined by WeChat; check their current requirements.
2. Open **Website Applications (网页应用)** → **Create Website Application (创建网页应用)**. Enter the 2ndBrain application name, description, website URL, logo, and any other materials requested.
3. Under website information, enter the **Authorization Callback Domain (授权回调域)** corresponding to the Logto social callback host from step 1. Enter the domain in the format WeChat requests, not a full callback path. Confirm with Logto's connector details if using a custom domain.
4. Submit the application for WeChat review. After approval, retrieve the website application's **App ID** and **App Secret**. Enter them only in Logto's server-side connector configuration; do not put the secret in 2ndBrain client code or commit it.
5. In the Logto **WeChat (Web)** connector, enter the WeChat App ID as the connector's `clientId` and App Secret as `clientSecret`. Leave the optional scope at the connector's documented default unless your approved WeChat app requires another setting. Enable the connector in Logto's **Sign-in experience**. Configure the experience so users can register and sign in with this connector. Test it in Logto first.

Reference: [Logto WeChat Web connector setup](https://docs.logto.io/integrations/wechat-web). This is the website QR-code flow; a native WeChat mobile app or an in-WeChat-browser flow has different requirements and is not implemented here.

## 3. Create a Logto OIDC application for Supabase

1. In Logto Console → **Applications** → **Create application**, choose **Third-party app → OIDC / OAuth → Traditional Web**. Give it a name such as `2ndBrain Supabase`.
2. Copy its **Client ID**, **Client Secret**, and OIDC **issuer** (the `issuer` in its discovery document). Logto's OIDC issuer generally includes `/oidc`; use the exact value from the discovery document, not a guessed URL.
3. Under **Redirect URIs**, add the callback URL shown in Supabase's new custom-provider screen (typically `https://<supabase-project-ref>.supabase.co/auth/v1/callback`; use your project's actual displayed URL and custom domain if applicable). Logto's URI is the URL Supabase receives the OIDC response on, not the 2ndBrain `/auth/callback`.
4. Allow the OIDC scopes the provider will request. Use `openid` and `profile`; also permit `email` if you configure the provider to request it. The third-party app may display a Logto consent screen.

See [Logto's third-party OIDC application guide](https://docs.logto.io/integrate-logto/third-party-applications).

## 4. Configure Supabase Auth

1. Open the correct Supabase project → **Authentication → Providers → New Provider** → **Auto-discovery (OIDC)**.
2. Set identifier to **`custom:wechat`** and name to `WeChat`. Enter the Logto OIDC **issuer**, the **Logto application's** Client ID and Client Secret, and scopes `openid` and `profile`. These are different credentials from the WeChat App ID and App Secret.
3. Enable **email optional** (`email_optional: true`) because WeChat may not supply an email. Leave PKCE and nonce verification enabled. If the dashboard does not expose the email-optional option, create or update the provider using the [Supabase custom-provider admin API](https://supabase.com/docs/guides/auth/custom-oauth-providers); keep the Supabase secret/service-role key on a trusted server only.
4. Copy the callback URL shown by Supabase into the Logto app's Redirect URIs from step 3. Save and enable the provider.
5. Optional: to skip the Logto sign-in chooser, configure the custom provider's **Authorization params** as `{"direct_sign_in":"social:<connector-idp-name>"}`, using the exact IdP name shown in Logto's WeChat connector. If it is wrong or the connector is disabled, Logto may show its normal sign-in page. See [Logto direct sign-in](https://docs.logto.io/end-user-flows/authentication-parameters/direct-sign-in).
6. Under Supabase **Authentication → URL Configuration**, add `https://<2ndbrain-domain>/auth/callback` to Redirect URLs. Also add `http://localhost:3000/auth/callback` for local testing. Set the Site URL to the intended production site. The app appends `next`, `callback_origin`, and `provider` query parameters; ensure your configured redirect URL pattern accepts the exact callback URL and its query string. Keep production redirect allowlists narrow.

If the dashboard does not offer the email-optional setting, the following server-side JavaScript updates an already-created `custom:wechat` provider. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` securely in that server's environment first; never put the service-role key in browser code or commit it.

```js
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const { error } = await admin.auth.admin.customProviders.updateProvider("custom:wechat", {
  email_optional: true
});
if (error) throw error;
```

## 5. Enable 2ndBrain on Railway

Deploy the code, then set the Railway service variable `WECHAT_LOGIN_ENABLED=true` and restart/redeploy the service. This is a feature flag, not a secret. The WeChat App Secret belongs in Logto and the Logto client secret belongs in Supabase; neither is needed as a Railway app variable. Remove the flag or set it to `false` to hide and disable the button.

Open 2ndBrain → Log in → **Continue with WeChat**. The user completes the Logto/WeChat flow, authorizes any Logto consent prompt, then returns through Supabase to onboarding or the requested page (default: chat). The same option appears on the landing-page login dialog, the login page, onboarding, and intent login.

## 6. Test and troubleshoot

- Test an unused WeChat account, a returning WeChat account, Google login, a cancelled login, and login on the desktop and mobile browsers you intend to support. A desktop QR code requires a WeChat app to scan it. Do not assume the native/in-WeChat mobile flows are supported by this website connector.
- Confirm a Supabase Auth user and an app `profiles` row are created, that the same user ID returns on subsequent WeChat logins, and that user-owned data is isolated. A no-email WeChat user can sign in when Supabase's email-optional setting is enabled; onboarding and account recovery should be tested for your own user journeys.
- Existing Google users may receive a separate user account if their WeChat identity has no email. Supabase can automatically link identities that share a verified email; do not fabricate an email or merge accounts based on an unverified claim. This app does not yet provide a manual WeChat-to-Google account-linking interface. See [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).
- If there is a WeChat callback-domain error, verify the domain registered in WeChat is the Logto social callback host. If Logto reports a redirect mismatch, verify Supabase's callback URI in the Logto application. If Supabase reports a redirect error, verify the 2ndBrain `/auth/callback` URL in Supabase URL Configuration.
- If the WeChat button is missing, check `WECHAT_LOGIN_ENABLED=true`, restart the app, and verify Supabase URL/key configuration. If it appears but the provider is missing, verify the custom identifier is exactly `custom:wechat` and the provider is enabled.
- `npm run test:wechat-auth` runs local mocked tests for provider selection, redirect handling, retry, and email-less profile preservation. It does not replace an end-to-end test with real WeChat, Logto, and Supabase credentials.
