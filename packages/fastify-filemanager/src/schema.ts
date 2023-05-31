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
