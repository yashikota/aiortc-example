// Ref: https://github.com/aiortc/aiortc/tree/main/examples/server
import { useCallback, useEffect, useRef, useState } from "react"
import "./App.css"

type VideoRuntimeInfo = {
  width?: number
  height?: number
  frameRate?: number
  cameraLabel?: string
}

function App() {
  const signalingUrlFromEnv = import.meta.env.VITE_SIGNALING_URL
  const signalingUrl =
    window.location.protocol === "https:" && signalingUrlFromEnv?.startsWith("http://")
      ? "/offer"
      : (signalingUrlFromEnv ?? "/offer")

  const [iceConnectionState, setIceConnectionState] = useState<string>("new")
  const [iceGatheringState, setIceGatheringState] = useState<string>("new")
  const [signalingState, setSignalingState] = useState<string>("stable")
  const [dataChannelLog, setDataChannelLog] = useState<string>("")
  const [offerSdp, setOfferSdp] = useState<string>("")
  const [answerSdp, setAnswerSdp] = useState<string>("")
  const [cameraError, setCameraError] = useState<string>("")
  const [isRunning, setIsRunning] = useState<boolean>(false)

  const [useStun, setUseStun] = useState<boolean>(false)
  const [useDataChannel, setUseDataChannel] = useState<boolean>(true)
  const [useAudio, setUseAudio] = useState<boolean>(false)
  const [useVideo, setUseVideo] = useState<boolean>(true)
  const [videoResolution, setVideoResolution] = useState<string>("")
  const [videoTransform, setVideoTransform] = useState<string>("none")
  const [dataChannelParams, setDataChannelParams] = useState<string>('{"ordered": true}')
  const [audioCodec, setAudioCodec] = useState<string>("default")
  const [videoCodec, setVideoCodec] = useState<string>("default")
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string>("")
  const [videoRuntimeInfo, setVideoRuntimeInfo] = useState<VideoRuntimeInfo>({})

  const currentStreamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const dcIntervalRef = useRef<ReturnType<typeof window.setInterval> | null>(null)
  const timeStartRef = useRef<number | null>(null)

  const refreshCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter((device) => device.kind === "videoinput")
      setAvailableCameras(videoDevices)

      if (videoDevices.length === 0) {
        setSelectedCameraId("")
        return
      }

      const stillExists = videoDevices.some((device) => device.deviceId === selectedCameraId)
      if (!selectedCameraId || !stillExists) {
        setSelectedCameraId(videoDevices[0].deviceId)
      }
    } catch (err) {
      console.error("Error enumerating devices:", err)
    }
  }, [selectedCameraId])

  useEffect(() => {
    refreshCameras()
    navigator.mediaDevices.addEventListener("devicechange", refreshCameras)
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshCameras)
    }
  }, [refreshCameras])

  const currentStamp = () => {
    if (timeStartRef.current === null) {
      timeStartRef.current = new Date().getTime()
      return 0
    }
    return new Date().getTime() - timeStartRef.current
  }

  const parseResolution = () => {
    if (!videoResolution) return {}
    const [width, height] = videoResolution.split("x")
    return { width: parseInt(width, 10), height: parseInt(height, 10) }
  }

  const createPeerConnection = () => {
    const config: RTCConfiguration = {}

    if (useStun) {
      config.iceServers = [{ urls: ["stun:stun.l.google.com:19302"] }]
    }

    const pc = new RTCPeerConnection(config)

    pc.addEventListener("icegatheringstatechange", () => {
      setIceGatheringState(pc.iceGatheringState)
    })

    pc.addEventListener("iceconnectionstatechange", () => {
      setIceConnectionState(pc.iceConnectionState)
    })

    pc.addEventListener("signalingstatechange", () => {
      setSignalingState(pc.signalingState)
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
    const lines = realSdp.split("\n")
    const mLineIndex = lines.findIndex((line) => line.startsWith("m=" + kind))

    if (mLineIndex === -1 || !lines.some((line) => codecRegex.test(line))) {
      return realSdp
    }

    const mLine = lines[mLineIndex].split(" ")
    const payloadTypes: string[] = []

    for (let i = 3; i < mLine.length; i += 1) {
      if (lines.some((line) => line.startsWith("a=rtpmap:" + mLine[i] + " " + codec))) {
        payloadTypes.push(mLine[i])
      }
    }

    if (payloadTypes.length === 0) {
      return realSdp
    }

    lines[mLineIndex] = [mLine[0], mLine[1], mLine[2], ...payloadTypes].join(" ")
    return lines.join("\n")
  }

  const negotiate = async () => {
    if (!pcRef.current) return

    const offer = await pcRef.current.createOffer()
    await pcRef.current.setLocalDescription(offer)

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

    let localOfferSdp = pcRef.current.localDescription?.sdp ?? ""
    if (audioCodec !== "default") localOfferSdp = sdpFilterCodec("audio", audioCodec, localOfferSdp)
    if (videoCodec !== "default") localOfferSdp = sdpFilterCodec("video", videoCodec, localOfferSdp)
    setOfferSdp(localOfferSdp)

    const response = await fetch(signalingUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: localOfferSdp,
        type: pcRef.current.localDescription?.type,
        video_transform: videoTransform,
      }),
    })

    const answer = await response.json()
    setAnswerSdp(answer.sdp)
    await pcRef.current.setRemoteDescription(answer)
  }

  const buildVideoConstraint = (opts?: { deviceId?: string }): MediaTrackConstraints => {
    const { width, height } = parseResolution()
    return {
      deviceId: opts?.deviceId ? ({ exact: opts.deviceId } as ConstrainDOMString) : undefined,
      width,
      height,
    }
  }

  const replaceVideoTrack = async (opts?: { deviceId?: string }) => {
    if (!pcRef.current || !useVideo) return

    const sender = pcRef.current.getSenders().find((s) => s.track?.kind === "video")
    if (!sender) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: buildVideoConstraint(opts),
      })
      const newTrack = stream.getVideoTracks()[0]
      if (!newTrack) return

      await sender.replaceTrack(newTrack)

      if (currentStreamRef.current) {
        currentStreamRef.current.getVideoTracks().forEach((track) => {
          track.stop()
          currentStreamRef.current?.removeTrack(track)
        })
        currentStreamRef.current.addTrack(newTrack)
      }

      const settings = newTrack.getSettings()
      const runtimeCamera = availableCameras.find((device) => device.deviceId === settings.deviceId)
      setVideoRuntimeInfo({
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate,
        cameraLabel: runtimeCamera?.label,
      })

      setCameraError("")
      await refreshCameras()
    } catch (err) {
      console.error("Error switching camera:", err)
      setCameraError("カメラ切替に失敗しました。")
    }
  }

  const switchCamera = async (deviceId: string) => {
    setSelectedCameraId(deviceId)
    if (!isRunning) return
    await replaceVideoTrack({ deviceId })
  }

  const stop = useCallback(() => {
    setIsRunning(false)

    if (dcRef.current) {
      dcRef.current.close()
      dcRef.current = null
    }

    if (dcIntervalRef.current) {
      clearInterval(dcIntervalRef.current)
      dcIntervalRef.current = null
    }

    if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach((track) => track.stop())
      currentStreamRef.current = null
    }
    setVideoRuntimeInfo({})

    if (pcRef.current) {
      pcRef.current.getTransceivers().forEach((transceiver) => {
        if (transceiver.stop) transceiver.stop()
      })
      pcRef.current.close()
      pcRef.current = null
    }
  }, [])

  const start = async () => {
    stop()
    setCameraError("")
    setDataChannelLog("")
    setOfferSdp("")
    setAnswerSdp("")
    timeStartRef.current = null

    pcRef.current = createPeerConnection()

    if (useDataChannel && pcRef.current) {
      const parameters = JSON.parse(dataChannelParams)
      const dc = pcRef.current.createDataChannel("chat", parameters)
      dcRef.current = dc

      dc.addEventListener("close", () => {
        if (dcIntervalRef.current) clearInterval(dcIntervalRef.current)
        setDataChannelLog((prev) => prev + "- close\n")
      })

      dc.addEventListener("open", () => {
        setDataChannelLog((prev) => prev + "- open\n")
        dcIntervalRef.current = window.setInterval(() => {
          const message = `ping ${currentStamp()}`
          setDataChannelLog((prev) => prev + `> ${message}\n`)
          dc.send(message)
        }, 1000)
      })

      dc.addEventListener("message", (evt) => {
        setDataChannelLog((prev) => prev + `< ${evt.data}\n`)
        if (evt.data.substring(0, 4) === "pong") {
          const elapsedMs = currentStamp() - parseInt(evt.data.substring(5), 10)
          setDataChannelLog((prev) => prev + ` RTT ${elapsedMs} ms\n`)
        }
      })
    }

    const videoConstraint = buildVideoConstraint({ deviceId: selectedCameraId || undefined })

    const constraints: MediaStreamConstraints = {
      audio: useAudio,
      video: useVideo ? videoConstraint : false,
    }

    if (constraints.audio || constraints.video) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        stream.getTracks().forEach((track) => {
          pcRef.current?.addTrack(track, stream)
        })
        currentStreamRef.current = stream
        const videoTrack = stream.getVideoTracks()[0]
        if (videoTrack) {
          const settings = videoTrack.getSettings()
          const runtimeCamera = availableCameras.find((device) => device.deviceId === settings.deviceId)
          setVideoRuntimeInfo({
            width: settings.width,
            height: settings.height,
            frameRate: settings.frameRate,
            cameraLabel: runtimeCamera?.label,
          })
        }
        await refreshCameras()
      } catch (err) {
        console.error("Could not acquire media:", err)
        setCameraError("カメラ起動に失敗しました。権限やデバイス設定を確認してください。")
        stop()
        return
      }
    }

    await negotiate()
    setIsRunning(true)
  }

  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  const dataChannelModeLabel = (() => {
    if (dataChannelParams === '{"ordered": true}') return "Ordered, Reliable"
    if (dataChannelParams === '{"ordered": false, "maxRetransmits": 0}')
      return "Unordered, No Retransmission"
    if (dataChannelParams === '{"ordered": false, "maxPacketLifetime": 500}')
      return "Unordered, 500ms Lifetime"
    return "Custom"
  })()

  const selectedCameraLabel =
    availableCameras.find((device) => device.deviceId === selectedCameraId)?.label || "Auto"
  const currentAudioCodecLabel = audioCodec === "default" ? "Auto" : audioCodec
  const currentVideoCodecLabel = videoCodec === "default" ? "Auto" : videoCodec
  const currentVideoResolutionLabel = videoResolution || "Auto"
  const currentVideoTransformLabel = videoTransform === "none" ? "No Transform" : "Object Detection"

  return (
    <div className="app-shell">
      <div className="page-bg" />
      <main className="app-grid">
        <section className="panel media-panel">
          <h2>Media / Status</h2>
          <audio ref={audioRef} autoPlay />
          <video ref={videoRef} autoPlay playsInline className="media-video" />
          <div className="status-grid">
            <p>
              <strong>ICE gathering:</strong> {iceGatheringState}
            </p>
            <p>
              <strong>ICE connection:</strong> {iceConnectionState}
            </p>
            <p>
              <strong>Signaling:</strong> {signalingState}
            </p>
            <p>
              <strong>Video:</strong>{" "}
              {videoRuntimeInfo.width && videoRuntimeInfo.height
                ? `${videoRuntimeInfo.width}x${videoRuntimeInfo.height}`
                : "n/a"}
              {videoRuntimeInfo.frameRate ? ` @ ${Math.round(videoRuntimeInfo.frameRate)}fps` : ""}
            </p>
            <p>
              <strong>Camera:</strong> {videoRuntimeInfo.cameraLabel || "n/a"}
            </p>
          </div>
        </section>

        <section className="panel controls">
          <h1>aiortc demo console</h1>
          <div className="button-row">
            <button onClick={start} className="btn btn-primary" disabled={isRunning}>
              Start
            </button>
            <button onClick={stop} className="btn btn-danger">
              Stop
            </button>
          </div>

          <div className="current-settings">
            <p>
              <strong>Current Selection</strong>
            </p>
            <p>Data Channel: {useDataChannel ? dataChannelModeLabel : "Off"}</p>
            <p>Audio Codec: {useAudio ? currentAudioCodecLabel : "Off"}</p>
            <p>Video Resolution: {useVideo ? currentVideoResolutionLabel : "Off"}</p>
            <p>Video Processing: {useVideo ? currentVideoTransformLabel : "Off"}</p>
            <p>Video Codec: {useVideo ? currentVideoCodecLabel : "Off"}</p>
            <p>Camera: {useVideo ? selectedCameraLabel : "Off"}</p>
          </div>

          {cameraError && <p className="error-text">{cameraError}</p>}

          <div className="option-grid">
            <label className="check-line">
              <input type="checkbox" checked={useStun} onChange={(e) => setUseStun(e.target.checked)} />
              <span>Use STUN Server</span>
            </label>

            <label className="check-line">
              <input
                type="checkbox"
                checked={useDataChannel}
                onChange={(e) => setUseDataChannel(e.target.checked)}
              />
              <span>Use Data Channel</span>
            </label>
            <label className="field-label" htmlFor="data-channel-mode">
              Data Channel Mode
            </label>
            <select
              id="data-channel-mode"
              value={dataChannelParams}
              onChange={(e) => setDataChannelParams(e.target.value)}
            >
              <option value='{"ordered": true}'>Ordered, Reliable</option>
              <option value='{"ordered": false, "maxRetransmits": 0}'>Unordered, No Retransmission</option>
              <option value='{"ordered": false, "maxPacketLifetime": 500}'>Unordered, 500ms Lifetime</option>
            </select>

            <label className="check-line">
              <input type="checkbox" checked={useAudio} onChange={(e) => setUseAudio(e.target.checked)} />
              <span>Use Audio</span>
            </label>
            <label className="field-label" htmlFor="audio-codec">
              Audio Codec
            </label>
            <select id="audio-codec" value={audioCodec} onChange={(e) => setAudioCodec(e.target.value)}>
              <option value="default">Auto</option>
              <option value="opus/48000/2">Opus</option>
              <option value="PCMU/8000">PCMU</option>
              <option value="PCMA/8000">PCMA</option>
            </select>

            <label className="check-line">
              <input type="checkbox" checked={useVideo} onChange={(e) => setUseVideo(e.target.checked)} />
              <span>Use Video</span>
            </label>
            <label className="field-label" htmlFor="video-resolution">
              Video Resolution
            </label>
            <select id="video-resolution" value={videoResolution} onChange={(e) => setVideoResolution(e.target.value)}>
              <option value="">Auto</option>
              <option value="320x240">320x240</option>
              <option value="640x480">640x480</option>
              <option value="960x540">960x540</option>
              <option value="1280x720">1280x720</option>
            </select>
            <label className="field-label" htmlFor="video-transform">
              Video Processing
            </label>
            <select id="video-transform" value={videoTransform} onChange={(e) => setVideoTransform(e.target.value)}>
              <option value="none">No Transform</option>
              <option value="detect">Object Detection</option>
            </select>
            <label className="field-label" htmlFor="video-codec">
              Video Codec
            </label>
            <select id="video-codec" value={videoCodec} onChange={(e) => setVideoCodec(e.target.value)}>
              <option value="default">Auto</option>
              <option value="VP8/90000">VP8</option>
              <option value="H264/90000">H264</option>
            </select>

            {useVideo && availableCameras.length > 0 && (
              <>
                <label className="field-label" htmlFor="camera-select">
                  Camera
                </label>
                <div className="camera-controls">
                  <select
                    id="camera-select"
                    value={selectedCameraId}
                    onChange={(e) => {
                      void switchCamera(e.target.value)
                    }}
                  >
                    {availableCameras.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="panel">
          <details className="sdp-toggle">
            <summary>Data Channel</summary>
            <pre>{dataChannelLog}</pre>
          </details>
        </section>

        <section className="panel">
          <details className="sdp-toggle">
            <summary>SDP</summary>
            <h3>Offer</h3>
            <pre>{offerSdp}</pre>
            <h3>Answer</h3>
            <pre>{answerSdp}</pre>
          </details>
        </section>
      </main>
    </div>
  )
}

export default App
