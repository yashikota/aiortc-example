// Ref: https://github.com/aiortc/aiortc/tree/main/examples/server
import { useRef, useState, useEffect } from "react"
import "./App.css"

// Add type definition for NodeJS.Timeout
declare global {
  interface Window {
    NodeJS: {
      Timeout: number;
    }
  }
}

function App() {
  // State management
  const [iceConnectionState, setIceConnectionState] = useState<string>("")
  const [iceGatheringState, setIceGatheringState] = useState<string>("")
  const [signalingState, setSignalingState] = useState<string>("")
  const [dataChannelLog, setDataChannelLog] = useState<string>("")
  const [offerSdp, setOfferSdp] = useState<string>("")
  const [answerSdp, setAnswerSdp] = useState<string>("")

  // Options
  const [useStun, setUseStun] = useState<boolean>(false)
  const [useDataChannel, setUseDataChannel] = useState<boolean>(true)
  const [useAudio, setUseAudio] = useState<boolean>(false)
  const [useVideo, setUseVideo] = useState<boolean>(true)
  const [videoResolution, setVideoResolution] = useState<string>("")
  const [videoTransform, setVideoTransform] = useState<string>("none")
  const [dataChannelParams, setDataChannelParams] = useState<string>('{"ordered": true}')
  const [audioCodec, setAudioCodec] = useState<string>("default")
  const [videoCodec, setVideoCodec] = useState<string>("default")

  // refs
  const currentStreamRef = useRef<MediaStream | null>(null)
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string | undefined>(undefined)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const dcIntervalRef = useRef<number | null>(null)
  const timeStartRef = useRef<number | null>(null)

  // Get available camera devices on mount
  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const videoDevices = devices.filter(device => device.kind === 'videoinput')
        setAvailableCameras(videoDevices)
        if (videoDevices.length > 0 && !selectedCameraId) {
          setSelectedCameraId(videoDevices[0].deviceId) // Select the first camera by default
        }
      } catch (err) {
        console.error("Error enumerating devices:", err)
      }
    }
    getDevices()
  }, [selectedCameraId]) // Re-run if selectedCameraId changes (though not strictly necessary here)

  const currentStamp = () => {
    if (timeStartRef.current === null) {
      timeStartRef.current = new Date().getTime()
      return 0
    }
    return new Date().getTime() - timeStartRef.current
  }

  const createPeerConnection = () => {
    const config: RTCConfiguration = {
    }

    if (useStun) {
      config.iceServers = [{ urls: ["stun:stun.l.google.com:19302"] }]
    }

    const pc = new RTCPeerConnection(config)

    pc.addEventListener("icegatheringstatechange", () => {
      setIceGatheringState(prev => prev + " -> " + pc.iceGatheringState)
    })

    pc.addEventListener("iceconnectionstatechange", () => {
      setIceConnectionState(prev => prev + " -> " + pc.iceConnectionState)
    })

    pc.addEventListener("signalingstatechange", () => {
      setSignalingState(prev => prev + " -> " + pc.signalingState)
    })

    pc.addEventListener("track", (evt) => {
      if (evt.track.kind === "video" && videoRef.current) {
        videoRef.current.srcObject = evt.streams[0]
      } else if (evt.track.kind === "audio" && audioRef.current) {
        audioRef.current.srcObject = evt.streams[0]
      }
    })

    return pc
  }

  const sdpFilterCodec = (kind: string, codec: string, realSdp: string) => {
    const pt = codec.split("/")[0]
    const codecRegex = new RegExp("a=rtpmap:" + pt + "\\s+" + codec)

    // Extract codec information from SDP
    const lines = realSdp.split("\n")

    const mLineIndex = lines.findIndex(line =>
      line.startsWith("m=" + kind)
    )
    if (mLineIndex === -1) {
      return realSdp
    }

    // Return unchanged if codec not found
    if (!lines.some(line => codecRegex.test(line))) {
      return realSdp
    }

    const mLine = lines[mLineIndex].split(" ")
    const payloadTypes = []

    for (let i = 3; i < mLine.length; i++) {
      if (lines.some(line =>
        line.startsWith("a=rtpmap:" + mLine[i] + " " + codec)
      )) {
        payloadTypes.push(mLine[i])
      }
    }

    if (payloadTypes.length === 0) {
      return realSdp
    }

    // Build new m= line
    const newMLine = [
      mLine[0],
      mLine[1],
      mLine[2],
      ...payloadTypes
    ]

    lines[mLineIndex] = newMLine.join(" ")

    return lines.join("\n")
  }

  const negotiate = async () => {
    if (!pcRef.current) return

    const offer = await pcRef.current.createOffer()
    await pcRef.current.setLocalDescription(offer)

    // Wait for ICE gathering to complete
    await new Promise<void>((resolve) => {
      if (pcRef.current?.iceGatheringState === "complete") {
        resolve()
      } else {
        const checkState = () => {
          if (pcRef.current?.iceGatheringState === "complete") {
            pcRef.current?.removeEventListener("icegatheringstatechange", checkState)
            resolve()
          }
        }
        pcRef.current?.addEventListener("icegatheringstatechange", checkState)
      }
    })

    let offerSdp = pcRef.current.localDescription?.sdp || ""

    // Codec filtering
    if (audioCodec !== "default") {
      offerSdp = sdpFilterCodec("audio", audioCodec, offerSdp)
    }
    if (videoCodec !== "default") {
      offerSdp = sdpFilterCodec("video", videoCodec, offerSdp)
    }

    setOfferSdp(offerSdp)

    const response = await fetch("http://localhost:8080/offer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sdp: offerSdp,
        type: pcRef.current.localDescription?.type,
        video_transform: videoTransform
      })
    })

    const answer = await response.json()
    setAnswerSdp(answer.sdp)
    await pcRef.current.setRemoteDescription(answer)
  }

  const switchCamera = async (deviceId: string) => {
    setSelectedCameraId(deviceId)

    if (!pcRef.current || !currentStreamRef.current) return

    // Stop existing video track
    currentStreamRef.current.getVideoTracks().forEach(track => track.stop())

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: useAudio, // Keep current audio setting
        video: { deviceId: { exact: deviceId } }
      })
      currentStreamRef.current = newStream // Update the ref with the new stream
      const newVideoTrack = newStream.getVideoTracks()[0]

      const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'video')
      if (sender && newVideoTrack) {
        await sender.replaceTrack(newVideoTrack)
      }
    } catch (err) {
      console.error("Error switching camera:", err)
    }
  }

  const start = async () => {
    pcRef.current = createPeerConnection()

    if (useDataChannel) {
      const parameters = JSON.parse(dataChannelParams)
      const dc = pcRef.current.createDataChannel("chat", parameters)
      dcRef.current = dc

      dc.addEventListener("close", () => {
        if (dcIntervalRef.current) {
          clearInterval(dcIntervalRef.current)
        }
        setDataChannelLog(prev => prev + "- close\n")
      })

      dc.addEventListener("open", () => {
        setDataChannelLog(prev => prev + "- open\n")
        dcIntervalRef.current = window.setInterval(() => {
          const message = `ping ${currentStamp()}`
          setDataChannelLog(prev => prev + `> ${message}\n`)
          dc.send(message)
        }, 1000)
      })

      dc.addEventListener("message", (evt) => {
        setDataChannelLog(prev => prev + `< ${evt.data}\n`)
        if (evt.data.substring(0, 4) === "pong") {
          const elapsedMs = currentStamp() - parseInt(evt.data.substring(5), 10)
          setDataChannelLog(prev => prev + ` RTT ${elapsedMs} ms\n`)
        }
      })
    }

    const constraints: MediaStreamConstraints = {
      audio: useAudio,
      video: useVideo
        ? {
            deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined,
            width: videoResolution ? parseInt(videoResolution.split("x")[0]) : undefined,
            height: videoResolution ? parseInt(videoResolution.split("x")[1]) : undefined
          }
        : false
    }

    if (constraints.audio || constraints.video) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        stream.getTracks().forEach(track => {
          pcRef.current?.addTrack(track, stream)
        })
        currentStreamRef.current = stream // Store the stream
      } catch (err) {
        console.error("Could not acquire media:", err)
        return
      }
    }

    await negotiate()
  }

  const stop = () => {
    if (dcRef.current) {
      dcRef.current.close()
    }

    if (dcIntervalRef.current) {
      clearInterval(dcIntervalRef.current)
    }

    // Stop media tracks from the stored stream
    if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach(track => track.stop())
    }

    if (pcRef.current) {
      pcRef.current.getTransceivers().forEach(transceiver => {
        if (transceiver.stop) {
          transceiver.stop()
        }
      })

      pcRef.current.getSenders().forEach(sender => {
        if (sender.track) {
          sender.track.stop()
        }
      })

      setTimeout(() => {
        if (pcRef.current) {
          pcRef.current.close()
        }
      }, 500)
    }
  }

  return (
    <div className="container mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">Options</h2>

      <div className="space-y-4 mb-6">
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={useDataChannel}
              onChange={(e) => setUseDataChannel(e.target.checked)}
              className="form-checkbox"
            />
            <span>Use Data Channel</span>
          </label>
          <select
            value={dataChannelParams}
            onChange={(e) => setDataChannelParams(e.target.value)}
            className="form-select"
          >
            <option value='{"ordered": true}'>Ordered, Reliable</option>
            <option value='{"ordered": false, "maxRetransmits": 0}'>Unordered, No Retransmission</option>
            <option value='{"ordered": false, "maxPacketLifetime": 500}'>Unordered, 500ms Lifetime</option>
          </select>
        </div>

        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={useAudio}
              onChange={(e) => setUseAudio(e.target.checked)}
              className="form-checkbox"
            />
            <span>Use Audio</span>
          </label>
          <select
            value={audioCodec}
            onChange={(e) => setAudioCodec(e.target.value)}
            className="form-select"
          >
            <option value="default">Default Codec</option>
            <option value="opus/48000/2">Opus</option>
            <option value="PCMU/8000">PCMU</option>
            <option value="PCMA/8000">PCMA</option>
          </select>
        </div>

        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={useVideo}
              onChange={(e) => setUseVideo(e.target.checked)}
              className="form-checkbox"
            />
            <span>Use Video</span>
          </label>
          <select
            value={videoResolution}
            onChange={(e) => setVideoResolution(e.target.value)}
            className="form-select"
          >
            <option value="">Default Resolution</option>
            <option value="320x240">320x240</option>
            <option value="640x480">640x480</option>
            <option value="960x540">960x540</option>
            <option value="1280x720">1280x720</option>
          </select>
          <select
            value={videoTransform}
            onChange={(e) => setVideoTransform(e.target.value)}
            className="form-select"
          >
            <option value="none">No Transform</option>
            <option value="detect">Object Detection</option>
          </select>
          <select
            value={videoCodec}
            onChange={(e) => setVideoCodec(e.target.value)}
            className="form-select"
          >
            <option value="default">Default Codec</option>
            <option value="VP8/90000">VP8</option>
            <option value="H264/90000">H264</option>
          </select>
        </div>

         {/* Camera Selection Dropdown */}
         {useVideo && availableCameras.length > 0 && (
           <div className="flex items-center space-x-4">
             <label htmlFor="camera-select" className="mr-2">Select Camera:</label>
             <select
               id="camera-select"
               value={selectedCameraId}
               onChange={(e) => switchCamera(e.target.value)}
               className="form-select"
             >
               {availableCameras.map(device => (
                 <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${device.deviceId.substring(0, 6)}`}</option>
               ))}
             </select>
           </div>
         )}

        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={useStun}
              onChange={(e) => setUseStun(e.target.checked)}
              className="form-checkbox"
            />
            <span>Use STUN Server</span>
          </label>
        </div>
      </div>

      <div className="space-x-4 mb-6">
        <button
          onClick={start}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          Start
        </button>
        <button
          onClick={stop}
          className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
        >
          Stop
        </button>
      </div>

      <h2 className="text-2xl font-bold mb-4">Status</h2>
      <div className="space-y-2 mb-6">
        <p>ICE gathering state: {iceGatheringState}</p>
        <p>ICE connection state: {iceConnectionState}</p>
        <p>Signaling state: {signalingState}</p>
      </div>

      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-4">Media</h2>
        <audio ref={audioRef} autoPlay />
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full max-w-4xl"
        />
      </div>

      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-4">Data Channel</h2>
        <pre className="bg-gray-100 p-4 rounded h-48 overflow-auto">
          {dataChannelLog}
        </pre>
      </div>

      <div>
        <h2 className="text-2xl font-bold mb-4">SDP</h2>
        <div className="space-y-4">
          <div>
            <h3 className="text-xl font-bold mb-2">Offer</h3>
            <pre className="bg-gray-100 p-4 rounded overflow-auto">
              {offerSdp}
            </pre>
          </div>
          <div>
            <h3 className="text-xl font-bold mb-2">Answer</h3>
            <pre className="bg-gray-100 p-4 rounded overflow-auto">
              {answerSdp}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
