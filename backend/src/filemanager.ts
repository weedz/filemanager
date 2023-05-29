import path from "node:path";
import fs from "node:fs/promises";
import fp from "fastify-plugin";
import { MultipartFile, MultipartValue } from "@fastify/multipart";
import sharp from "sharp";
import { urlAlphabet, customAlphabet } from "nanoid";
import { FastifyReply, FastifyRequest } from "fastify";

export const nanoidUrlAlphabet = customAlphabet(urlAlphabet);

const paths = {
    productImages: {
        relative: "/uploads/images/products",
        absolute: path.resolve("./uploads/images/products"),
    },
}

export const filemanager = fp(async (fastify, _opts) => {
    fastify.get("/filemanager", async (_req, reply) => {
        reply.send({msg: "from filemanager"})
    });

    fastify.delete("/product/image", {
        // onRequest: authenticateRoute("admin"),
        schema: {
            body: {
                type: "object",
                properties: {
                    path: { type: "string" },
                }
            }
        }
    }, deleteImage);

    fastify.post("/product/image", {
        // onRequest: authenticateRoute("admin"),
        schema: {
            body: {
                type: "object",
                properties: {
                    productId: {
                        $ref: "#sharedSchema",
                        type: "object",
                        properties: {
                            value: {type: "number"}
                        }
                    },
                    image: { $ref: "#sharedSchema" },
                }
            }
        },
    }, uploadImage);
});

async function uploadImage(req: FastifyRequest, reply: FastifyReply) {
    const body = req.body as {
        productId: MultipartValue<number>
        image: MultipartFile
    };

    const newFileName = `${nanoidUrlAlphabet()}.avif`;

    const inputBuffer = await body.image.toBuffer();

    try {
        // TODO: Resize, quality?
        await sharp(inputBuffer)
            .resize({
                withoutEnlargement: true,
                width: 2000,
                fit: "inside"
            })
            .avif()
            .toFile(path.join(paths.productImages.absolute, newFileName));

        return reply.send("OK");
    } catch (err) {
        return reply.status(400).send({error: "failed to process image"});
    }
}

async function deleteImage(req: FastifyRequest, reply: FastifyReply) {
    const body = req.body as {
        path: number
    };
    
    // TODO: Check if image exists

    const imagePath = path.resolve(`.${body.path}`);

    try {
        if (imagePath.startsWith(paths.productImages.absolute)) {
            fs.unlink(imagePath);
        }
    } catch (_) {
        // noop, file does not exist?
    }

    reply.send({success: true});
}
