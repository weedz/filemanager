import { Static, Type } from '@sinclair/typebox'
import { RouteShorthandOptions } from 'fastify';

export const Move = Type.Object({
    source: Type.String(),
    destination: Type.String(),
});

export type MoveType = Static<typeof Move>;

export const fileManagerQuerystringSchema = Type.Object({
    path: Type.String()
});

export type FileManagerRouteQuerystringType = Static<typeof fileManagerQuerystringSchema>

export const fileManagerSchema: RouteShorthandOptions = {
    schema: {
        querystring: fileManagerQuerystringSchema
    },
} as const;

export enum HTTPMethod {
    GET = "GET",
    POST = "POST",
    DELETE = "DELETE",
}

const FileManagerIndexActions = Type.Object({
    method: Type.Enum(HTTPMethod),
    endpoint: Type.String(),
    schema: Type.Partial(
        Type.Object({
            query: Type.Any(),
            body: Type.Any(),
            path: Type.Any(),
        })
    ),
    description: Type.String(),
});

export const FileManagerIndex = Type.Object({
    title: Type.String(),
    actions: Type.Array(FileManagerIndexActions),
});

export type FileManagerIndexType = Static<typeof FileManagerIndex>;
