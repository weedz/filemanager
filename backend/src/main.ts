import { fastify } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { filemanager } from "./filemanager.js";

const app = fastify({
    logger: {
        level: "error"
    }
}).withTypeProvider<TypeBoxTypeProvider>();

app.get("/", async (_req, reply) => {
    reply.send({
        msg: "root"
    })
});
app.register(fastifyMultipart, {
    attachFieldsToBody: true,
    sharedSchemaId: "#sharedSchema",
    limits: {
        fileSize: 52428800, // 50MiB
    },
});
app.register(filemanager, {
    prefix: "/filemanager",
    sharedSchemaId: "#sharedSchema"
});

const port = 3000;
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
app.listen({
    port,
    host,
}, err => {
    if (err) {
        console.error("Failed to start:", err);
        process.exit(1);
    }

    console.log(`Server started. Listening on ${host}:${port}`);
});
