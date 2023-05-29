All paths are relative from the `uploads` directory.

- `GET /ls?path=:path`
  - Response:
    ```jsonc
    {
        "files": [
            {
                "path": ":path/filename.webp",
                "basename": "filename.webp",
                "size": 100, // in bytes
                "thumbnail": "/path/to/thumbnails/filename.webp",
            }
        ],
        "directories": [
            {
                "path": ":path/directory",
                "basename": "directory",
                "items": 10, // ?
            }
        ]
    }
    ```
- `GET /stat?path=:path`
  - Response:
    ```jsonc
    {
        "basename": "filename.webp",
        "path": ":path",
        "size": 100, // in bytes
        "mime": "image/webp",
        "thumbnail": "/path/to/thumbnails/filename.webp",
    }
    ```

## Directory actions
- `POST /dir?path=:path`
  - Create a directory
- `DELETE /dir?path=:path`
  - Delete a directory

## File actions
- `POST /file?path=:path`
  - Upload a file
- `DELETE /file?path=:path`
  - Delete a file
