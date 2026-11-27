# Custom Transport Example

Contoh transport kustom yang mengimplementasikan `LogTransport` dan digunakan dengan `createLoggerManager`.

## File

- `webhook.transport.ts` - implementasi `LogTransport`.
- `main.ts` - contoh menjalankan transport dengan logger manager.

## Jalankan

```bash
pnpm exec tsc -p examples/tsconfig.json
node examples/dist/custom-transport/main.js
```
