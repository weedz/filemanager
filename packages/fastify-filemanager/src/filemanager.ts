import path from "node:path";
import fs from "node:fs/promises";
import fp from "fastify-plugin";
import { MultipartFile } from "@fastify/multipart";
import sharp from "sharp";
import { urlAlphabet, customAlphabet } from "nanoid";
import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { FileManagerIndex, FileManagerIndexType, FileManagerRouteQuerystringType, MoveType, fileManagerQuerystringSchema, fileManagerSchema, HTTPMethod } from "./schema.js";
import { Move } from "./schema.js";

const nanoidUrlAlphabet = customAlphabet(urlAlphabet);

interface FileManagerPluginOpts extends FastifyPluginOptions {
    prefix?: string
    sharedSchemaId: string
}

interface FileManagerRoute {
    Querystring: FileManagerRouteQuerystringType
}

interface FileNode {
    type: "file"
    filename: string
    size: number
    id?: number
}
interface ImageFileNode extends FileNode {
    image: {
        thumbnail: string
        width: number | undefined; // `undefined` means we could not read the width from source image
        height: number | undefined; // `undefined` means we could not read the height from source image
    }
}

interface DirNode {
    type: "dir"
    nodes: Record<string, FileNode | DirNode>
}

interface FileSystemManifest {
    root: DirNode
}

// TODO: Make these configurable
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

let filesystem: FileSystemManifest;
refreshManifest();

async function routes(fastify: FastifyInstance, opts: FileManagerPluginOpts) {
    fastify.get<{
        Reply: FileManagerIndexType
    }>("/", {
        schema: {
            response: {
                200: FileManagerIndex
            }
        }
    }, async (_req, reply) => {
        reply.status(200).send({
            title: "This is the file system",
            actions: [
                {
                    method: HTTPMethod.GET,
                    endpoint: "/ls",
                    schema: {
                        query: {
                            path: {type: "string"}
                        },
                    },
                    description: "List files/directories in :path"
                },
                {
                    method: HTTPMethod.POST,
                    endpoint: "/mkdir",
                    schema: {
                        query: {
                            path: {type: "string"}
                        },
                    },
                    description: "Create a new directory"
                },
                {
                    method: HTTPMethod.DELETE,
                    endpoint: "/rm",
                    schema: {
                        query: {
                            path: {type: "string"}
                        },
                    },
                    description: "Recursively deletes a directory or file"
                },
                {
                    method: HTTPMethod.GET,
                    endpoint: "/file",
                    schema: {
                        query: {
                            path: {type: "string"}
                        },
                    },
                    description: "Show information about a file"
                },
                {
                    method: HTTPMethod.POST,
                    endpoint: "/mv",
                    schema: {
                        body: {
                            source: {type: "string"},
                            destination: {type: "string"}
                        }
                    },
                    description: "Move a file or folder. The parent of 'body.destination' _must_ exist."
                },
                {
                    method: HTTPMethod.POST,
                    endpoint: "/file",
                    schema: {
                        query: {
                            path: {type: "string"}
                        },
                        body: {
                            file: {type: "multipart"}
                        }
                    },
                    description: "Upload a file to 'query.path'"
                },
                {
                    method: HTTPMethod.GET,
                    endpoint: "/download",
                    schema: {
                        query: {
                            path: {type: "string"}
                        }
                    },
                    description: "Return the file referenced by 'query.path' as an 'application/octet-stream'. Or, simply, download the file."
                }
            ]
        });
    });

    fastify.get<FileManagerRoute>("/ls", fileManagerSchema, listFiles);
    fastify.post<FileManagerRoute>("/mkdir", fileManagerSchema, mkdir);
    fastify.delete<FileManagerRoute>("/rm", fileManagerSchema, rm);
    fastify.post("/mv", {schema: {body: Move}} ,mv);
    fastify.get<FileManagerRoute>("/file", fileManagerSchema, statFile);
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

    // TODO: zip
    fastify.get<FileManagerRoute>("/download", fileManagerSchema, downloadFile);
}

async function refreshManifest() {
    const manifestPath = path.resolve("./uploads/manifest.json");
    try {
        const file = await fs.open(manifestPath);
        const manifest = await file.readFile();
        filesystem = JSON.parse(manifest.toString()) as FileSystemManifest;
        file.close();
    } catch (_) {
        // Manifest probably does not exist, so we create a new.
        filesystem = {
            root: {
                type: "dir",
                nodes: {}
            }
        };
        await fs.writeFile(manifestPath, JSON.stringify(filesystem));
    }
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

async function uploadFile(req: FastifyRequest<{
    Body: {
        file: MultipartFile
    };
    Querystring: {
        path: string
    }
}>, reply: FastifyReply) {
    const targetDirectory = getNode(normalizePath(req.query.path));
    if (!targetDirectory || targetDirectory.type === "file") {
        console.error("invalid directory");
        return null;
    }

    const file = req.body.file;
    const newFileName = nanoidUrlAlphabet();

    const extname = path.extname(file.filename);
    const newFileNameWithExtension = `${newFileName}${extname}`;

    const inputBuffer = await file.toBuffer();
    await fs.writeFile(path.join(paths.root.absolute, newFileNameWithExtension), inputBuffer);

    const newNode: FileNode = {
        type: "file",
        filename: newFileNameWithExtension,
        size: inputBuffer.length,
    };
    targetDirectory.nodes[file.filename] = newNode;

    if (file.mimetype.startsWith("image")) {
        // Create a thumbnail
        try {
            const image = sharp(inputBuffer);
            const imageMeta = await image.metadata();
            await image
                .resize({
                    withoutEnlargement: true,
                    width: 128,
                    fit: "inside"
                })
                .webp()
                .toFile(path.join(paths.thumbnails.absolute, `${newFileName}.webp`));
            (newNode as ImageFileNode).image = {
                height: imageMeta.height,
                width: imageMeta.width,
                thumbnail: `${newFileName}.webp`
            };
        } catch (err) {
            console.error("Failed to create thumbnail");
        }
    }

    await saveManifest();

    return reply.status(201).send(newNode);
}

async function mv(req: FastifyRequest<{
    Body: MoveType
}>, reply: FastifyReply) {
    await refreshManifest();
    const source = normalizePath(req.body.source);
    const destination = normalizePath(req.body.destination);

    if (source === "" || source === "/") {
        return reply.status(400).send({ err: "invalid source" });
    }

    if (source === destination) {
        return reply.status(400).send({ err: "'source' can not be 'destination'" });
    }

    // Check if `source` exists
    if (!checkIfPathExists(source)) {
        console.log("Source does not exist?");
        return reply.status(400).send({ err: "invalid source" });
    }

    // Check if `destination` exists
    if (checkIfPathExists(destination)) {
        return reply.status(400).send({ err: "destination already exists" });
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

    return reply.status(200).send(Object.keys(tree.nodes).map(nodeName => {
        const node = tree.nodes[nodeName];
        // TODO: Would it be faster to use a Map over `node.type` with a function to resolve the given type?
        if (node.type === "dir") {
            return {
                type: node.type,
                name: nodeName,
            };
        }
        if ("image" in node) {
            const imageNode = node as ImageFileNode;
            return {
                type: imageNode.type,
                name: nodeName,
                thumbnail: imageNode.image.thumbnail,
                size: imageNode.size
            }
        }

        return {
            type: node.type,
            name: nodeName,
            // TODO: Thumbnails for common file types? Like ".rar", ".zip", ".txt", ".pdf" etc.
            size: node.size
        }
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

async function rmNode(file: DirNode | FileNode) {
    if (file.type === "file") {
        await fs.rm(path.join(paths.root.absolute, file.filename));
        if ("image" in file) {
            const imageNode = file as ImageFileNode;
            if (imageNode.image.thumbnail) {
                try {
                    await fs.rm(path.join(paths.thumbnails.absolute, imageNode.image.thumbnail));
                } catch (err) {
                    console.log("Failed to remove thumbnail:", err);
                }
            }
        }
    } else {
        for (const node of Object.values(file.nodes)) {
            await rmNode(node);
        }
    }
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

    await rmNode(parentNode.tree.nodes[parentNode.head]);

    delete parentNode.tree.nodes[parentNode.head];

    await saveManifest();

    return reply.status(200).send();
}

async function downloadFile(req: FastifyRequest<FileManagerRoute>, reply: FastifyReply) {
    const requestedPaths = req.query.path.split(",");
    if (requestedPaths.length > 1) {
        // TODO: "multi-file" download. Make a ".zip"-archive?
        return reply.status(422).send({msg: `TODO: "multi-file" download. Make a ".zip"-archive?`});
    } else {
        const nodePath = normalizePath(req.query.path);
        const node = getNode(nodePath);
    
        if (!node) {
            return reply.status(404).send();
        }
    
        if (node.type === "dir") {
            // "multi-file" download. Make a ".zip"-archive?
            // TODO: Zip multiple files and folders?
            return reply.status(422).send({msg: `TODO: "multi-file" download. Make a ".zip"-archive?`});
        }
    
        const filePath = path.join(paths.root.absolute, node.filename);
    
        const file = await fs.open(filePath);
    
        const stream = file.createReadStream();
        reply.header("Content-Type", "application/octet-stream");
        reply.header("Content-Disposition", `attachment; filename=${node.filename}`);
        return reply.send(stream);
    }
}

export const filemanager = fp(async (fastify, opts: FileManagerPluginOpts) => {
    fastify.register(routes, opts);
});
