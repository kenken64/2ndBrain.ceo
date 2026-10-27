const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Connection, PublicKey, Transaction, SystemProgram, TransactionInstruction } = require("@solana/web3.js");

test("Solana JSON-RPC and transaction construction work with the patched client", async () => {
  const calls = [];
  const fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request.method);
    const results = {
      getBalance: { context: { slot: 1 }, value: 12345 },
      getLatestBlockhash: { context: { slot: 1 }, value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 42 } },
      getTransaction: null
    };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: results[request.method] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const connection = new Connection("http://127.0.0.1:8899", { commitment: "confirmed", fetch });
  const publicKey = new PublicKey("11111111111111111111111111111111");
  assert.equal(await connection.getBalance(publicKey), 12345);
  const block = await connection.getLatestBlockhash();
  assert.equal(block.lastValidBlockHeight, 42);
  assert.equal(await connection.getParsedTransaction("test-signature", { maxSupportedTransactionVersion: 0 }), null);
  const transaction = new Transaction({ feePayer: publicKey, recentBlockhash: block.blockhash });
  transaction.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: publicKey, lamports: 1 }));
  transaction.add(new TransactionInstruction({ keys: [], programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), data: Buffer.from("AI CUBER quote test") }));
  assert.ok(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length > 0);
  assert.deepEqual(calls, ["getBalance", "getLatestBlockhash", "getTransaction"]);
});
