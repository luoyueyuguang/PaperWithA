import { createSyncApi } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
createSyncApi().listen(port, () => console.log(`PaperWithA sync API listening on http://127.0.0.1:${port}`));
