# AjoShield

**Your circle. Your rules. Protected on-chain.**

AjoShield brings Nigeria's trust-based Ajo/Esusu/Adashe rotating savings circles onto Solana. Every year, groups lose money when a "chairman" disappears with the pot — there's no record, no proof, and no recourse. AjoShield gives these circles a shared, transparent view everyone can check.

## Live demo
🔗 ajoshield.vercel.app

## What's real vs. simulated (read this first)
We're building this transparently, stage by stage:
- ✅ **Real**: Wallet connection (Phantom) and USDC balance — read live from Solana devnet via `@solana/web3.js`.
- ⚠️ **Simulated (UI-level)**: Circle browsing/joining, contribution tracking, payout release, and bank withdrawal. These demonstrate the full intended user flow, but are not yet backed by an on-chain program.
- 🔜 **Next milestone**: An Anchor smart contract that actually holds and releases circle funds on-chain, replacing the simulated logic.

## Features
- Browse and join weekly or monthly savings circles
- Connect a Solana wallet and view real devnet USDC balance (shown converted to Naira)
- Track group contributions and release payouts
- Simulated withdrawal to Nigerian banks (Access, GTBank, Zenith, UBA, and more)

## Tech stack
- Solana (devnet)
- Phantom wallet
- `@solana/web3.js`
- HTML / CSS / JavaScript (static PWA)
- Vercel (hosting)
- Circle's devnet USDC faucet (for test funds)

## Why Solana
Ajo circles involve small, frequent contributions from many members. Solana's low transaction fees and speed make it realistic to bring these contributions fully on-chain — something not practical on higher-fee chains.

## Running locally
This is a single static `index.html` file — clone the repo and open it in a browser, or serve it with any static file server. A Phantom wallet set to Solana Devnet is needed to test wallet connect and balance display.

## Team
Built solo by JNectar
(https://github.com/JNectar9), based in Nigeria.

## License
MIT
