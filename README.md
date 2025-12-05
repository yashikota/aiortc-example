# aiortc-example

This is a WebRTC example application that demonstrates real-time communication between a web browser and a Python server using [aiortc](https://github.com/aiortc/aiortc). The application supports video/audio streaming, data channels, and various codec options.

https://github.com/user-attachments/assets/e8beb7ad-8cee-4602-b477-290bc7820cef

## Docker

```sh
docker compose up --build -d
```

## Prerequisites

- uv
- pnpm

## Installation

1. Clone the repository

    ```bash
    git clone https://github.com/yashikota/aiortc-example.git
    cd aiortc-example
    ```

2. Install Python dependencies

    ```bash
    cd server
    uv sync
    ```

3. Install Node.js dependencies

    ```bash
    cd web
    pnpm install
    ```

## Usage

1. Start the server

    ```bash
    cd server
    uv run src/server.py
    ```

    Server Started at <http://localhost:8000>

2. In a separate terminal, start the web application

    ```bash
    cd web
    pnpm dev
    ```

3. Open your browser and navigate to <http://localhost:5173>

## Configuration Options

### Web Interface

- **Data Channel**: Enable/disable data channel communication
  - Ordered, Reliable
  - Unordered, No Retransmission
  - Unordered, 500ms Lifetime

- **Audio**: Enable/disable audio streaming
  - Codec options: Default, Opus, PCMU, PCMA

- **Video**: Enable/disable video streaming
  - Resolution options: Default, 320x240, 640x480, 960x540, 1280x720
  - Transform options: No Transform, Object Detection
  - Codec options: Default, VP8, H264

- **STUN Server**: Enable/disable STUN server usage

## Status Information

The application displays real-time information about

- ICE gathering state
- ICE connection state
- Signaling state
- Data channel communication
- SDP offer/answer

## Acknowledgments

This project is based on the [aiortc examples](https://github.com/aiortc/aiortc/tree/main/examples)
