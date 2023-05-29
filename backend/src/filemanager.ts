import path from "node:path";
import fs from "node:fs/promises";
import fp from "fastify-plugin";
import { MultipartFile } from "@fastify/multipart";
import sharp from "sharp";
import { urlAlphabet, customAlphabet } from "nanoid";
import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";

const nanoidUrlAlphabet = customAlphabet(urlAlphabet);

interface FileManagerPluginOpts extends FastifyPluginOptions {
    prefix?: string
    sharedSchemaId: string
}

// const nanoidUrlAlphabet = customAlphabet(urlAlphabet);
const paths = {
    root: {
        relative: "/uploads/root",
        absolute: path.resolve("./uploads/root"),
    },
    thumbnails: {
        relative: "/uploads/thumbnails",
        absolute: path.resolve("./uploads/thumbnails"),
    }
};

interface FileManagerRoute {
    Querystring: {
        path: string
    }
}

interface FileNode {
    type: "file"
    filename: string
    size: number
    id?: number
    thumbnail?: string
}

interface DirNode {
    type: "dir"
    nodes: Record<string, FileNode | DirNode>
}

interface FileSystemManifest {
    root: DirNode
    type: "dir"
}

let filesystem: FileSystemManifest;
refreshManifest();

const fileManagerQuerystringSchema = {
    type: "object",
    properties: {
        path: { type: "string" }
    },
    required: ["path"]
} as const;

const fileManagerSchema = {
    schema: {
        querystring: fileManagerQuerystringSchema
    },
} as const;

async function refreshManifest() {
    const manifestPath = path.resolve("./uploads/manifest.json");
    const manifest = await fs.readFile(manifestPath);
    filesystem = JSON.parse(manifest.toString()) as FileSystemManifest;
}

async function saveManifest() {
    const manifestPath = path.resolve("./uploads/manifest.json");

    await fs.writeFile(manifestPath, JSON.stringify(filesystem, null, 4));
}

function checkIfPathExists(nodePath: string) {
    if (nodePath === "root") {
        return true;
    }
    const segments = nodePath.split("/");

    // console.log("Tree:", filesystem.root.nodes["temp"].nodes);

    let tree = filesystem.root as DirNode | FileNode;
    for (const segment of segments) {
        // console.log("segment:", segment)
        if (!tree || tree.type !== "dir") {
            return false
        }
        tree = tree.nodes[segment];
    }

    return !!tree;
}

function getNode(nodePath: string) {
    if (nodePath === "root") {
        return filesystem.root;
    }
    const segments = nodePath.split("/");
    let tree = filesystem.root as DirNode | FileNode;
    for (const segment of segments) {
        if (tree.type !== "dir") {
            return null
        }
        tree = tree.nodes[segment];
    }

    return tree;
}

function getParentNode(nodePath: string) {
    const segments = nodePath.split("/");
    const head = segments.pop()!;
    let tree = filesystem.root as DirNode | FileNode;
    for (const segment of segments) {
        if (tree.type !== "dir") {
            return null
        }
        tree = tree.nodes[segment];
    }
    if (tree.type === "file") {
        console.log("how are we even here??");
        return null;
    }

    return {head, tree};
}

function normalizePath(nodePath: string): string {
    nodePath = path.normalize(nodePath);

    if (nodePath === "" || nodePath === "/") {
        return "root";
    }

    if (nodePath.startsWith("/")) {
        return nodePath.slice(1);
    }

    return nodePath;
}

async function routes(fastify: FastifyInstance, opts: FileManagerPluginOpts) {
    fastify.get("/", async (_req, reply) => {
        await refreshManifest();
        reply.send({
            msg: "filemanager"
        });
    });

    fastify.get("/ls", fileManagerSchema, listFiles);
    fastify.get("/stat", fileManagerSchema, statFile);

    fastify.post("/mkdir", fileManagerSchema, mkdir);
    fastify.delete("/rm", fileManagerSchema, rm);

    fastify.post("/mv", mv);

    fastify.post("/file", {
        // onRequest: authenticateRoute("admin"),
        schema: {
            querystring: fileManagerQuerystringSchema,
            body: {
                type: "object",
                properties: {
                    file: { $ref: opts.sharedSchemaId },
                }
            }
        },
    }, uploadFile);
}

async function uploadFile(req: FastifyRequest<{
    Body: {
        file: MultipartFile
    };
    Querystring: {
        path: string
    }
}>, reply: FastifyReply) {
    const filePath = path.normalize(req.query.path);

    const targetDirectory = getNode(normalizePath(req.query.path));
    if (!targetDirectory || targetDirectory.type === "file") {
        console.error("invalid directory");
        return null;
    }

    const file = req.body.file;
    const newFileName = nanoidUrlAlphabet();

    const extname = path.extname(file.filename);

    const inputBuffer = await file.toBuffer();
    if (file.mimetype.startsWith("image")) {
        // Create a thumbnail
        try {
            await sharp(inputBuffer)
                .resize({
                    withoutEnlargement: true,
                    width: 128,
                    fit: "inside"
                })
                .webp()
                .toFile(path.join(paths.thumbnails.absolute, `${newFileName}.webp`));
        } catch (err) {
            console.error("Failed to create thumbnail");
        }
    }

    const newFileNameWithExtension = `${newFileName}${extname}`;

    await fs.writeFile(path.join(paths.root.absolute, filePath, newFileNameWithExtension), inputBuffer);

    const newNode: FileNode = {
        type: "file",
        filename: newFileNameWithExtension,
        size: inputBuffer.length,
        thumbnail: `${newFileName}.webp`,
    };
    targetDirectory.nodes[file.filename] = newNode;

    await saveManifest();

    return reply.status(201).send(newNode);
}

async function mv(req: FastifyRequest<{
    Body: {
        source?: string
        destination?: string
    }
}>, reply: FastifyReply) {
    await refreshManifest();
    const source = normalizePath(req.body.source!);
    const destination = normalizePath(req.body.destination!);

    if (source === "" || source === "/") {
        return reply.status(400).send({ err: "invalid source" });
    }

    if (source === destination) {
        return reply.status(400).send({ err: "'source' can not be 'destination'" });
    }

    const sourcePath = path.join(paths.root.absolute, source);
    const destinationPath = path.join(paths.root.absolute, destination);

    // Check if `source` exists
    if (!checkIfPathExists(source)) {
        console.log("Source does not exist?");
        return reply.status(400).send({ err: "invalid source" });
    }

    // Check if `destination` exists
    if (checkIfPathExists(destination)) {
        return reply.status(400).send({ err: "destination already exists" });
    }

    try {
        // TODO: Can you rename to a directory which does not exist?
        await fs.rename(sourcePath, destinationPath);
    } catch (err) {
        console.log("Failed to mv:", err);
        return reply.status(500).send();
    }

    const sourceParentNode = getParentNode(source);
    if (!sourceParentNode) {
        console.error("Should never be here...");
        return null;
    }
    const sourceTree = sourceParentNode.tree.nodes[sourceParentNode.head];
    delete sourceParentNode.tree.nodes[sourceParentNode.head];

    const destinationParentNode = getParentNode(destination);
    if (!destinationParentNode) {
        console.error("Should never be here...");
        return null;
    }

    destinationParentNode.tree.nodes[destinationParentNode.head] = sourceTree;

    await saveManifest();

    return reply.status(200).send();
}

async function listFiles(req: FastifyRequest<FileManagerRoute>, reply: FastifyReply) {
    await refreshManifest();
    const filePath = normalizePath(req.query.path);

    const tree = getNode(filePath);
    if (!tree) {
        return reply.status(404).send();
    }
    if (tree.type === "file") {
        return reply.status(400).send();
    }

    // return reply.status(200).send(Object.keys(tree.nodes).map(node => ({
    return reply.status(200).send(Object.keys(tree.nodes).map(nodeName => {
        const node = tree.nodes[nodeName];
        return {
            type: node.type,
            // name: (node.type === "file") ? node.filename : nodeName,
            name: nodeName,
        };
    }));
}

async function statFile(req: FastifyRequest<FileManagerRoute>, reply: FastifyReply) {
    await refreshManifest();
    const filePath = normalizePath(req.query.path);

    const node = getNode(filePath);
    if (!node) {
        return reply.status(404).send();
    }
    if (node.type === "dir") {
        return reply.status(400).send();
    }

    return reply.status(200).send(node);
}

async function mkdir(req: FastifyRequest<FileManagerRoute>, reply: FastifyReply) {
    await refreshManifest();
    const newDirPath = normalizePath(req.query.path);
    if (!newDirPath) {
        return reply.status(400).send();
    }

    if (checkIfPathExists(newDirPath)) {
        return reply.status(200).send();
    }

    try {
        await fs.mkdir(path.join(paths.root.absolute, newDirPath), { recursive: true });
    } catch (err) {
        console.log("Failed to create directory:", err);
        return reply.status(500).send({ err: "failed to create directory" });
    }

    const segments = newDirPath.split("/");
    let tree = filesystem.root as DirNode | FileNode;
    for (const segment of segments) {
        if (tree.type !== "dir") {
            return null
        }
        if (!(segment in tree.nodes)) {
            tree.nodes[segment] = {
                type: "dir",
                nodes: {},
            };
        }
        tree = tree.nodes[segment];
    }

    await saveManifest();


    return reply.status(201).send();
}

async function rm(req: FastifyRequest<FileManagerRoute>, reply: FastifyReply) {
    const dirPath = normalizePath(req.query.path);
    if (!dirPath) {
        return reply.status(400).send();
    }

    const parentNode = getParentNode(dirPath);
    if (!parentNode || !parentNode.tree.nodes[parentNode.head]) {
        return reply.status(404).send();
    }

    const node = parentNode.tree.nodes[parentNode.head];
    const nodePath = node.type === "dir" ? dirPath : path.join(path.dirname(dirPath), node.filename);

    try {
        await fs.rm(path.join(paths.root.absolute, nodePath), { recursive: true });
    } catch (err) {
        console.log("Failed to delete directory:", err);
        return reply.status(500).send({ err: "failed to delete directory" });
    }

    if (node.type === "file" && node.thumbnail) {
        try {
            await fs.rm(path.join(paths.thumbnails.absolute, node.thumbnail));
        } catch (err) {
            console.log("Failed to thumbnail:", err);
            // return reply.status(500).send({ err: "Failed to thumbnail" });
        }
    }

    delete parentNode.tree.nodes[parentNode.head];

    await saveManifest();

    return reply.status(200).send();
}

export const filemanager = fp(async (fastify, opts: FileManagerPluginOpts) => {
    fastify.register(routes, opts);
});
