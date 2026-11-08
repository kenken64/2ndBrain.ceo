# micro:bit Gamepad Blocks

The free `microbit-gamepad` marketplace app runs the block editor from
`kenken64/elecfreak-microbit-gamepad`. It needs no personal cloud agent.
Users install it in Marketplace and launch it from My Workflows.

Set these runtime variables on 2ndBrain.ceo:

```dotenv
MICROBIT_GAMEPAD_URL=https://your-gamepad.up.railway.app/api/2ndbrain/launch
MICROBIT_GAMEPAD_SESSION_SECRET=<random secret of at least 32 bytes>
```

Set the same `MICROBIT_GAMEPAD_SESSION_SECRET` on the gamepad service. Also set
its `MARKETPLACE_LAUNCH_VERIFY_URL` to this app's
`https://2ndbrain.ceo/api/marketplace/launch-session/verify` and share the existing
`MARKETPLACE_LAUNCH_VERIFY_SECRET` with that service. This verifier secret must
also have at least 32 bytes and should differ from the gamepad signing secret.
No Supabase credentials are needed on the gamepad service.

The editor validates the signed launch token, establishes an eight-hour secure
browser session and checks account/installation/logout status with 2ndBrain on
each protected request. The original launch timestamp is preserved for logout
revocation. Direct access without a valid session is denied.

Deploy the gamepad's Dockerfile and attach a Railway volume at `/data`. Saved
programs and the last successful HEX are isolated by the signed user ID under
`/data/users/<user_id>/`. The editor's **Last built HEX** link downloads that
persisted firmware without rebuilding. See the gamepad repository's
`docs/railway.md` for deployment and volume details. No schema migration is
needed; the existing marketplace installation and verification routes handle
this catalog entry.
