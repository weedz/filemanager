All paths are relative from the `uploads/{root,thumbnails}` directory.

## `GET /ls?path=:path`
Response:
```jsonc
{
    "files": [
        {
            "path": ":path/filename.webp",
            // "basename": "filename.webp",
            "size": 100, // in bytes
            "thumbnail": "/path/to/thumbnails/filename.webp",
            "thumbnailId": 1, // Some enum value, 1=".zip", 2=".css" or something ?
        }
    ],
    "directories": [
        {
            "path": ":path/directory",
            // "basename": "directory",
            "items": 10, // ?
        }
    ]
}
```

## `GET /stat?path=:path`
Response:
```jsonc
{
    // "basename": "filename.webp",
    "path": ":path",
    "size": 100, // in bytes
    // "mime": "image/webp",
    "thumbnail": "/path/to/thumbnails/filename.webp",
}
```

## Directory actions

### `POST /mkdir?path=:path`
Create a directory

## File actions

### `POST /file?path=:path`
Upload a file

## "Node" actions

### `POST /mv`
Move a file/directory. The "parent" directory _must_ exist.

Body:
```json
{
  "source": "/path/to/source",
  "destination": "/path/to/destination"
}
```

### `DELETE /rm?path=:path`
Delete a file or directory.

## TODO

- Better "filesystem implementation"... "id"/inode instead of path?
