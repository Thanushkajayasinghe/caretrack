import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
  Alert,
  Dimensions,
  Platform,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { format, isToday, isYesterday } from 'date-fns';
import { Colors, Fonts } from '../theme/tokens';
import { snapshotAPI } from '../services/api';
import { getSocket } from '../services/socket';
import { getBaseUrl, getServerUrl } from '../config/server';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function formatTimestamp(ts) {
  if (!ts) return 'Just now';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return 'Just now';
    if (isToday(d)) return `Today, ${format(d, 'h:mm a')}`;
    if (isYesterday(d)) return `Yesterday, ${format(d, 'h:mm a')}`;
    return format(d, 'MMM d, h:mm a');
  } catch {
    return 'Just now';
  }
}

export default function SnapshotModal({ visible, onClose, child }) {
  const [selectedTab, setSelectedTab] = useState('audio'); // 'audio' | 'screen' | 'camera'
  const [durationSeconds, setDurationSeconds] = useState(20);
  const [isRecording, setIsRecording] = useState(false);
  const [isCapturingScreen, setIsCapturingScreen] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [countdown, setCountdown] = useState(20);
  const [snapshots, setSnapshots] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Live Listen State
  const [isLiveListening, setIsLiveListening] = useState(false);
  const [liveListenStatus, setLiveListenStatus] = useState('idle'); // 'idle' | 'connecting' | 'live' | 'stopped'
  const [liveElapsedTime, setLiveElapsedTime] = useState(0);
  const liveTimerRef = useRef(null);

  // Live Stream Recording State
  const [isRecordingLiveStream, setIsRecordingLiveStream] = useState(false);
  const [liveRecSeconds, setLiveRecSeconds] = useState(0);
  const [isSavingLiveClip, setIsSavingLiveClip] = useState(false);
  const liveRecTimerRef = useRef(null);

  // Equalizer wave animations
  const waveAnim1 = useRef(new Animated.Value(0.3)).current;
  const waveAnim2 = useRef(new Animated.Value(0.6)).current;
  const waveAnim3 = useRef(new Animated.Value(0.9)).current;
  const waveAnim4 = useRef(new Animated.Value(0.5)).current;
  const waveAnim5 = useRef(new Animated.Value(0.4)).current;

  // Audio Player State
  const [activeSnapshot, setActiveSnapshot] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const webViewRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (visible && child?.id) {
      loadHistory();
    } else {
      stopPlayback();
      if (isRecordingLiveStream) {
        handleStopLiveRecording();
      }
      if (isLiveListening) {
        handleStopLiveListen();
      }
      setIsRecording(false);
      setIsCapturingScreen(false);
      setPreviewImage(null);
      if (timerRef.current) clearInterval(timerRef.current);
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
      if (liveRecTimerRef.current) clearInterval(liveRecTimerRef.current);
    }
  }, [visible, child?.id]);

  // Wave bar animation loop during live listen
  useEffect(() => {
    let anim;
    if (isLiveListening) {
      const createBarAnim = (val, minVal, maxVal, dur) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(val, { toValue: maxVal, duration: dur, useNativeDriver: true }),
            Animated.timing(val, { toValue: minVal, duration: dur, useNativeDriver: true }),
          ])
        );

      anim = Animated.parallel([
        createBarAnim(waveAnim1, 0.25, 1.0, 320),
        createBarAnim(waveAnim2, 0.35, 0.9, 450),
        createBarAnim(waveAnim3, 0.2, 1.1, 280),
        createBarAnim(waveAnim4, 0.4, 0.85, 390),
        createBarAnim(waveAnim5, 0.3, 0.95, 340),
      ]);
      anim.start();
    }
    return () => anim?.stop();
  }, [isLiveListening]);

  // Pulse animation while recording
  useEffect(() => {
    let anim;
    if (isRecording) {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      anim.start();
    } else {
      pulseAnim.setValue(1);
    }
    return () => anim?.stop();
  }, [isRecording]);

  const updateSnapshots = (updater) => {
    setSnapshots((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const seen = new Set();
      return (next || []).filter((item) => {
        if (!item?.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    });
  };

  // Socket listener for when snapshot is ready
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleSnapshotReady = (data) => {
      if (data?.childId === child?.id) {
        setIsRecording(false);
        setIsCapturingScreen(false);
        if (timerRef.current) clearInterval(timerRef.current);
        if (data.snapshot) {
          updateSnapshots((prev) => [data.snapshot, ...prev]);
          if (data.snapshot.media_type === 'screenshot') {
            Alert.alert('Screen Captured', 'New screenshot received from child device.');
          } else {
            // Auto-select and play the new recording
            playSnapshot(data.snapshot);
          }
        } else {
          loadHistory();
        }
      }
    };

    const handleSnapshotError = (err) => {
      console.warn('snapshot:error from server:', err);
      setIsRecording(false);
      setIsCapturingScreen(false);
      if (timerRef.current) clearInterval(timerRef.current);
      Alert.alert('Notice', err?.error || 'Unable to capture right now.');
    };

    const handleLiveStatus = (data) => {
      console.log('📡 [Parent LiveListen] handleLiveStatus:', JSON.stringify(data));
      if (data?.childId === child?.id) {
        if (data.status === 'active') {
          setLiveListenStatus('live');
        } else if (data.status === 'stopped' || data.status === 'ended') {
          setIsLiveListening(false);
          setLiveListenStatus('idle');
          if (liveTimerRef.current) clearInterval(liveTimerRef.current);
          webViewRef.current?.injectJavaScript(`if (window.stopPcm) window.stopPcm(); true;`);
        } else if (data.status === 'timeout') {
          setIsLiveListening(false);
          setLiveListenStatus('idle');
          if (liveTimerRef.current) clearInterval(liveTimerRef.current);
          webViewRef.current?.injectJavaScript(`if (window.stopPcm) window.stopPcm(); true;`);
          Alert.alert('Live Listen Notice', data.message || 'Live session reached the 5-minute safety limit.');
        }
      }
    };

    const handleLiveChunk = (data) => {
      if (data?.childId === child?.id && data?.chunkBase64) {
        setLiveListenStatus('live');
        console.log(`🔊 [Parent LiveListen] Received audio chunk: ${data.chunkBase64.length} b64 chars`);
        webViewRef.current?.injectJavaScript(`if (window.playPcm) window.playPcm("${data.chunkBase64}"); true;`);
      }
    };

    const handleLiveError = (err) => {
      console.warn('❌ [Parent LiveListen] live_listen:error from server:', err);
      setIsLiveListening(false);
      setLiveListenStatus('idle');
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
      webViewRef.current?.injectJavaScript(`if (window.stopPcm) window.stopPcm(); true;`);
      Alert.alert('Live Listen Error', err?.error || 'Unable to connect to live audio stream.');
    };

    socket.on('snapshot:ready', handleSnapshotReady);
    socket.on('snapshot:error', handleSnapshotError);
    socket.on('live_listen:status', handleLiveStatus);
    socket.on('live_audio:chunk', handleLiveChunk);
    socket.on('live_listen:error', handleLiveError);

    return () => {
      socket.off('snapshot:ready', handleSnapshotReady);
      socket.off('snapshot:error', handleSnapshotError);
      socket.off('live_listen:status', handleLiveStatus);
      socket.off('live_audio:chunk', handleLiveChunk);
      socket.off('live_listen:error', handleLiveError);
    };
  }, [child?.id]);

  const getSnapshotFileUrl = (fileName) => {
    if (!fileName) return '';
    const baseUrl = getBaseUrl();
    return `${baseUrl}/snapshots/file/${fileName}`;
  };

  const loadHistory = async () => {
    if (!child?.id) return;
    setLoadingHistory(true);
    try {
      const { data } = await snapshotAPI.list(child.id, { mediaType: 'all' });
      updateSnapshots(data?.snapshots || []);
    } catch (err) {
      console.warn('Failed to load snapshot history:', err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const isWebViewReadyRef = useRef(false);
  const pendingPlayItemRef = useRef(null);

  const pollForCompletedSnapshot = async (reqId, attempt = 0) => {
    if (attempt > 6) {
      setIsRecording(false);
      loadHistory();
      return;
    }
    try {
      const { data } = await snapshotAPI.list(child.id, { mediaType: 'all' });
      const list = data?.snapshots || [];
      if (list.length > 0) {
        const recent = list.find((s) => s.id === reqId || (Date.now() - new Date(s.recorded_at).getTime()) < 45000);
        if (recent) {
          setIsRecording(false);
          updateSnapshots(list);
          playSnapshot(recent);
          return;
        }
      }
    } catch (_e) {}
    setTimeout(() => pollForCompletedSnapshot(reqId, attempt + 1), 2500);
  };

  const pollForCompletedScreenshot = async (reqId, attempt = 0) => {
    if (attempt > 8) {
      setIsCapturingScreen(false);
      loadHistory();
      Alert.alert(
        'Capture Notice',
        'Did not receive a screenshot from the child device in time.\n\nTip: On the child phone, make sure "CareTrack Accessibility Guard" is toggled OFF and back ON in Android Settings > Accessibility to activate the screenshot permission.'
      );
      return;
    }
    try {
      const { data } = await snapshotAPI.list(child.id, { mediaType: 'all' });
      const list = data?.snapshots || [];
      if (list.length > 0) {
        const recent = list.find(
          (s) =>
            s.id === reqId ||
            (s.media_type === 'screenshot' && (Date.now() - new Date(s.recorded_at).getTime()) < 35000)
        );
        if (recent) {
          setIsCapturingScreen(false);
          updateSnapshots(list);
          return;
        }
      }
    } catch (_e) {}
    setTimeout(() => pollForCompletedScreenshot(reqId, attempt + 1), 2000);
  };

  const handleTakeScreenshot = async () => {
    if (isCapturingScreen || isRecording) return;
    const reqId = `req_${Date.now()}`;

    setIsCapturingScreen(true);
    console.log(`📸 Triggering screenshot capture for child ${child.id}, reqId=${reqId}`);

    try {
      await snapshotAPI.request({
        childId: child.id,
        mediaType: 'screenshot',
        requestId: reqId,
      });
      console.log('✅ REST snapshot:request (screenshot) delivered successfully');
    } catch (err) {
      console.error('❌ REST snapshot:request failed, trying socket fallback:', err.response?.data || err.message);
      const socket = getSocket();
      if (socket?.connected) {
        try {
          socket.emit('snapshot:request', {
            childId: child.id,
            mediaType: 'screenshot',
            requestId: reqId,
          });
        } catch (_sErr) {}
      } else {
        setIsCapturingScreen(false);
        Alert.alert('Request Failed', err.response?.data?.error || 'Failed to reach server. Please try again.');
        return;
      }
    }

    setTimeout(() => pollForCompletedScreenshot(reqId, 0), 2000);
  };

  const handleStartCapture = async () => {
    if (isRecording) return; // Prevent double taps

    const socket = getSocket();
    const reqId = `req_${Date.now()}`;

    setIsRecording(true);
    setCountdown(durationSeconds);

    console.log(`🎙️ Triggering surroundings capture for child ${child.id}, reqId=${reqId}`);

    // Fast-path via socket if connected
    if (socket?.connected) {
      try {
        socket.emit('snapshot:request', {
          childId: child.id,
          mediaType: 'audio',
          options: { durationSeconds },
          requestId: reqId,
        });
      } catch (_sErr) {}
    }

    // Guaranteed REST dispatch ensuring backend command queue receives it
    try {
      await snapshotAPI.request({
        childId: child.id,
        mediaType: 'audio',
        durationSeconds,
        requestId: reqId,
      });
      console.log('✅ REST snapshot:request delivered to server successfully');
    } catch (err) {
      console.error('❌ REST snapshot:request failed:', err.response?.data || err.message);
      if (!socket?.connected) {
        setIsRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
        Alert.alert('Request Failed', err.response?.data?.error || 'Failed to reach server. Please try again.');
        return;
      }
    }

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          pollForCompletedSnapshot(reqId, 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleStartLiveListen = async () => {
    if (isLiveListening || isRecording) return;
    stopPlayback();
    const socket = getSocket();
    const reqId = `live_${Date.now()}`;
    console.log('🎙️ [Parent LiveListen] handleStartLiveListen triggered, socket connected:', socket?.connected, 'childId:', child?.id);
    setIsLiveListening(true);
    setLiveListenStatus('connecting');
    setLiveElapsedTime(0);

    const token = await AsyncStorage.getItem('accessToken');
    const srvUrl = getServerUrl();
    const wsHost = srvUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://').replace(/\/api\/?$/i, '').replace(/\/+$/, '');
    const childId = child?.id || child?._id;
    const wsUrl = `${wsHost}/ws/live-audio?role=parent&token=${encodeURIComponent(token || '')}&childId=${childId}`;

    // Connect WebView directly to live audio WebSocket relay & unlock audio
    webViewRef.current?.injectJavaScript(`
      if (window.unlockAudio) window.unlockAudio();
      if (window.startLiveStream) window.startLiveStream("${wsUrl}");
      true;
    `);

    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    liveTimerRef.current = setInterval(() => {
      setLiveElapsedTime((prev) => prev + 1);
    }, 1000);

    // 1. Fast socket emission
    if (socket?.connected) {
      try {
        socket.emit('live_listen:start', { childId: child.id, requestId: reqId });
      } catch (_e) {}
    }

    // 2. Guaranteed REST delivery
    try {
      await snapshotAPI.request({
        childId: child.id,
        mediaType: 'live_listen',
        durationSeconds: 300,
        requestId: reqId,
      });
      console.log('✅ [Parent LiveListen] REST live_listen delivered to backend successfully');
    } catch (restErr) {
      console.warn('⚠️ [Parent LiveListen] REST live_listen notice:', restErr.response?.data || restErr.message);
    }
  };

  const handleStartLiveRecording = () => {
    if (!isLiveListening || isRecordingLiveStream) return;
    setIsRecordingLiveStream(true);
    setLiveRecSeconds(0);
    if (liveRecTimerRef.current) clearInterval(liveRecTimerRef.current);
    liveRecTimerRef.current = setInterval(() => {
      setLiveRecSeconds((prev) => prev + 1);
    }, 1000);
    webViewRef.current?.injectJavaScript(`
      if (window.startLiveRecording) window.startLiveRecording();
      true;
    `);
  };

  const handleStopLiveRecording = () => {
    if (!isRecordingLiveStream) return;
    setIsRecordingLiveStream(false);
    setIsSavingLiveClip(true);
    if (liveRecTimerRef.current) clearInterval(liveRecTimerRef.current);
    webViewRef.current?.injectJavaScript(`
      if (window.stopLiveRecording) window.stopLiveRecording();
      true;
    `);
  };

  const handleStopLiveListen = async () => {
    if (isRecordingLiveStream) {
      handleStopLiveRecording();
    }
    const socket = getSocket();
    const reqId = `stop_${Date.now()}`;
    if (socket?.connected) {
      try {
        socket.emit('live_listen:stop', { childId: child.id });
      } catch (_e) {}
    }
    webViewRef.current?.injectJavaScript(`if (window.stopLiveStream) window.stopLiveStream(); true;`);
    setIsLiveListening(false);
    setLiveListenStatus('idle');
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    if (liveRecTimerRef.current) clearInterval(liveRecTimerRef.current);

    try {
      await snapshotAPI.request({
        childId: child.id,
        mediaType: 'live_listen_stop',
        requestId: reqId,
      });
    } catch (_e) {}
  };

  const playSnapshot = (item) => {
    const cleanUrl = getSnapshotFileUrl(item.file_name);

    setActiveSnapshot(item);
    setIsPlaying(true);
    setCurrentTime(0);
    setAudioDuration(item.duration_seconds || 20);

    // Invalidate is_viewed badge in background
    if (!item.is_viewed) {
      snapshotAPI.markViewed(item.id).catch(() => {});
      setSnapshots((prev) =>
        prev.map((s) => (s.id === item.id ? { ...s, is_viewed: true } : s))
      );
    }

    if (!isWebViewReadyRef.current) {
      pendingPlayItemRef.current = item;
      return;
    }

    // Play in audio webview engine
    webViewRef.current?.injectJavaScript(`
      if (window.playAudioUrl) {
        window.playAudioUrl("${cleanUrl}");
      }
      true;
    `);
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      webViewRef.current?.injectJavaScript(`if (window.pauseAudio) window.pauseAudio(); true;`);
      setIsPlaying(false);
    } else {
      webViewRef.current?.injectJavaScript(`if (window.resumeAudio) window.resumeAudio(); true;`);
      setIsPlaying(true);
    }
  };

  const stopPlayback = () => {
    webViewRef.current?.injectJavaScript(`if (window.stopAudio) window.stopAudio(); true;`);
    setActiveSnapshot(null);
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleDeleteSnapshot = (item) => {
    const isScreen =
      item.media_type === 'screenshot' ||
      item.file_name?.endsWith('.jpg') ||
      item.file_name?.endsWith('.png') ||
      item.file_name?.endsWith('.jpeg');

    const title = isScreen ? 'Delete Screenshot' : 'Delete Recording';
    const message = isScreen
      ? 'Are you sure you want to permanently delete this screenshot?'
      : 'Are you sure you want to permanently delete this surroundings clip?';

    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (activeSnapshot?.id === item.id) {
            stopPlayback();
          }
          if (previewImage?.id === item.id) {
            setPreviewImage(null);
          }
          setSnapshots((prev) => prev.filter((s) => s.id !== item.id));
          try {
            await snapshotAPI.delete(item.id);
          } catch (err) {
            console.warn('Failed to delete snapshot:', err.message);
          }
        },
      },
    ]);
  };

  const handleWebViewMessage = (event) => {
    try {
      console.log('🌐 [WebView Msg]:', event.nativeEvent.data);
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'ready') {
        isWebViewReadyRef.current = true;
        if (pendingPlayItemRef.current) {
          const item = pendingPlayItemRef.current;
          pendingPlayItemRef.current = null;
          playSnapshot(item);
        }
      } else if (msg.type === 'progress') {
        setCurrentTime(Math.floor(msg.currentTime || 0));
        if (msg.duration && !isNaN(msg.duration) && msg.duration > 0) {
          setAudioDuration(Math.floor(msg.duration));
        }
      } else if (msg.type === 'ended') {
        setIsPlaying(false);
        setCurrentTime(0);
      } else if (msg.type === 'chunk_played') {
        setLiveListenStatus('live');
      } else if (msg.type === 'ws_status') {
        if (msg.status === 'active' || msg.status === 'connected') {
          setLiveListenStatus('live');
        } else if (msg.status === 'reconnecting' || msg.status === 'connecting') {
          setLiveListenStatus('connecting');
        } else if (msg.status === 'ended' || msg.status === 'closed') {
          setIsLiveListening(false);
          setLiveListenStatus('idle');
          if (liveTimerRef.current) clearInterval(liveTimerRef.current);
          if (liveRecTimerRef.current) clearInterval(liveRecTimerRef.current);
        }
      } else if (msg.type === 'live_recording_ready') {
        console.log(`💾 Live recording ready (${msg.durationSeconds}s, ${msg.fileSize || 0} bytes). Saving to cloud...`);
        (async () => {
          try {
            const { data } = await snapshotAPI.saveLive({
              childId: child.id,
              mediaBase64: msg.base64,
              durationSeconds: msg.durationSeconds || liveRecSeconds || 10,
              recordedAt: new Date().toISOString(),
            });
            if (data?.snapshot) {
              updateSnapshots((prev) => [data.snapshot, ...prev]);
              Alert.alert(
                'Clip Saved',
                `Recorded ${data.snapshot.duration_seconds || msg.durationSeconds}s live audio clip saved to Past Surroundings Clips below.`
              );
            }
          } catch (saveErr) {
            console.warn('❌ Failed to save live recording:', saveErr.response?.data || saveErr.message);
            Alert.alert('Save Failed', 'Could not save the live clip to history. Please try again.');
          } finally {
            setIsSavingLiveClip(false);
          }
        })();
      } else if (msg.type === 'live_record_error') {
        console.warn('Live recording notice:', msg.error);
        setIsSavingLiveClip(false);
        setIsRecordingLiveStream(false);
        if (liveRecTimerRef.current) clearInterval(liveRecTimerRef.current);
        Alert.alert('Recording Notice', msg.error || 'Could not record live audio.');
      } else if (msg.type === 'error') {
        console.warn('Audio playback notice:', msg.error);
        setIsPlaying(false);
        if (msg.error && (msg.error.includes('no supported sources') || msg.error.includes('Media code'))) {
          Alert.alert('Recording Notice', 'This recording file is no longer available on the server. Please take a new snapshot.');
        }
      }
    } catch (_e) {}
  };

  // HTML5 audio player for hidden WebView
  const playerHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body style="background:transparent;margin:0;padding:0;">
      <audio id="audioPlayer" preload="auto" playsinline controls style="width:100%;height:30px;opacity:0;"></audio>
      <script>
        var player = document.getElementById('audioPlayer');

        function notify(type, data) {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: type }, data || {})));
          }
        }

        notify('ready');

        window.playAudioUrl = function(url) {
          try {
            player.pause();
            player.currentTime = 0;
            // Clean any old child sources
            while (player.firstChild) {
              player.removeChild(player.firstChild);
            }

            // Set src directly on audio element - Chromium automatically parses audio/aac and audio/mp4
            player.src = url;
            player.load();
            
            var promise = player.play();
            if (promise !== undefined) {
              promise.then(function() {
                notify('status', { msg: 'Playing' });
              }).catch(function(e) {
                notify('error', { error: 'Audio play notice: ' + (e.message || String(e)) });
              });
            }
          } catch (err) {
            notify('error', { error: 'Player init error: ' + (err.message || String(err)) });
          }
        };

        window.pauseAudio = function() {
          player.pause();
        };

        window.resumeAudio = function() {
          if (!player.src) {
            notify('error', { error: 'No audio source loaded to resume.' });
            return;
          }
          var p = player.play();
          if (p !== undefined) {
            p.catch(function(e) {
              notify('error', { error: 'Resume error: ' + e.message });
            });
          }
        };

        window.stopAudio = function() {
          player.pause();
          player.currentTime = 0;
          player.removeAttribute('src');
          while (player.firstChild) {
            player.removeChild(player.firstChild);
          }
        };

        player.ontimeupdate = function() {
          notify('progress', {
            currentTime: player.currentTime,
            duration: player.duration || 0
          });
        };

        player.onended = function() {
          notify('ended');
        };

        player.onerror = function() {
          var err = player.error ? (player.error.message || 'Media code: ' + player.error.code) : 'Unknown player error';
          notify('error', { error: err });
        };

        // Real-time Web Audio PCM Stream Player
        var audioCtx = null;
        var gainNode = null;
        var nextPcmTime = 0;

        function initPcmContext() {
          if (!audioCtx) {
            var AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContext({ sampleRate: 16000 });
            gainNode = audioCtx.createGain();
            gainNode.gain.value = 1.0; // Clean natural gain (prevents speaker-to-mic feedback loop distortion)
            gainNode.connect(audioCtx.destination);
            notify('pcm_ctx', { state: audioCtx.state });
          }
          if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(function() {
              notify('pcm_resumed', { state: audioCtx.state });
            }).catch(function(e) {
              notify('error', { error: 'AudioCtx resume notice: ' + (e.message || String(e)) });
            });
          }
          if (nextPcmTime < audioCtx.currentTime) {
            nextPcmTime = audioCtx.currentTime;
          }
        }

        window.unlockAudio = function() {
          try {
            initPcmContext();
            // Trigger 1-sample silent sound through native <audio> to activate Android audio routing
            player.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
            player.play().then(function() {
              notify('pcm_unlocked', { status: 'ok' });
            }).catch(function() {});
          } catch (_e) {}
        };

        var liveWs = null;
        var isStreamingRequested = false;
        var reconnectAttempts = 0;

        var isRecordingLive = false;
        var recordedPcmChunks = [];
        var liveRecordStartTime = 0;

        window.startLiveRecording = function() {
          recordedPcmChunks = [];
          isRecordingLive = true;
          liveRecordStartTime = Date.now();
          notify('live_record_status', { recording: true });
        };

        function writeString(view, offset, string) {
          for (var i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
          }
        }

        function createWavFromPcmChunks(chunks, sampleRate) {
          sampleRate = sampleRate || 16000;
          var numChannels = 1;
          var bytesPerSample = 2; // 16-bit PCM
          var blockAlign = numChannels * bytesPerSample;
          var byteRate = sampleRate * blockAlign;

          var totalDataLen = 0;
          for (var i = 0; i < chunks.length; i++) {
            totalDataLen += chunks[i].byteLength;
          }

          var wavBuffer = new ArrayBuffer(44 + totalDataLen);
          var view = new DataView(wavBuffer);

          // RIFF chunk descriptor
          writeString(view, 0, 'RIFF');
          view.setUint32(4, 36 + totalDataLen, true);
          writeString(view, 8, 'WAVE');

          // "fmt " subchunk
          writeString(view, 12, 'fmt ');
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true); // PCM = 1
          view.setUint16(22, numChannels, true);
          view.setUint32(24, sampleRate, true);
          view.setUint32(28, byteRate, true);
          view.setUint16(32, blockAlign, true);
          view.setUint16(34, 16, true);

          // "data" subchunk
          writeString(view, 36, 'data');
          view.setUint32(40, totalDataLen, true);

          var u8Wav = new Uint8Array(wavBuffer);
          var offset = 44;
          for (var j = 0; j < chunks.length; j++) {
            var chunkU8 = new Uint8Array(chunks[j]);
            u8Wav.set(chunkU8, offset);
            offset += chunkU8.byteLength;
          }

          return u8Wav;
        }

        function uint8ToBase64(u8Arr) {
          var CHUNK_SIZE = 0x8000;
          var index = 0;
          var length = u8Arr.length;
          var result = '';
          while (index < length) {
            var slice = u8Arr.subarray(index, Math.min(index + CHUNK_SIZE, length));
            result += String.fromCharCode.apply(null, slice);
            index += CHUNK_SIZE;
          }
          return btoa(result);
        }

        window.stopLiveRecording = function() {
          if (!isRecordingLive && recordedPcmChunks.length === 0) return;
          isRecordingLive = false;
          var durationSec = Math.max(1, Math.round((Date.now() - liveRecordStartTime) / 1000));

          if (recordedPcmChunks.length === 0) {
            notify('live_record_error', { error: 'No audio chunks were captured to save.' });
            return;
          }

          try {
            var wavU8 = createWavFromPcmChunks(recordedPcmChunks, 16000);
            var base64Wav = uint8ToBase64(wavU8);
            var size = wavU8.byteLength;
            recordedPcmChunks = [];
            notify('live_recording_ready', {
              base64: base64Wav,
              durationSeconds: durationSec,
              fileSize: size
            });
          } catch (err) {
            recordedPcmChunks = [];
            notify('live_record_error', { error: 'WAV encoding failed: ' + (err.message || String(err)) });
          }
        };

        window.startLiveStream = function(url) {
          try {
            isStreamingRequested = true;
            if (liveWs) {
              try { liveWs.close(); } catch (_e) {}
              liveWs = null;
            }
            initPcmContext();
            notify('ws_status', { status: 'connecting', url: url });

            liveWs = new WebSocket(url);
            liveWs.binaryType = 'arraybuffer';

            liveWs.onopen = function() {
              reconnectAttempts = 0;
              notify('ws_status', { status: 'connected' });
            };

            liveWs.onmessage = function(event) {
              if (typeof event.data === 'string') {
                try {
                  var meta = JSON.parse(event.data);
                  if (meta.type === 'stream_ended') {
                    notify('ws_status', { status: 'ended' });
                  } else if (meta.type === 'stream_started') {
                    notify('ws_status', { status: 'active' });
                  }
                } catch (_e) {}
              } else if (event.data instanceof ArrayBuffer) {
                playPcmArrayBuffer(event.data);
              }
            };

            liveWs.onerror = function(err) {
              notify('error', { error: 'Live WS error: ' + (err && err.message ? err.message : 'connection failed') });
            };

            liveWs.onclose = function(e) {
              if (isStreamingRequested && reconnectAttempts < 5) {
                reconnectAttempts++;
                notify('ws_status', { status: 'reconnecting', attempt: reconnectAttempts });
                setTimeout(function() {
                  if (isStreamingRequested) {
                    window.startLiveStream(url);
                  }
                }, 1200);
              } else {
                notify('ws_status', { status: 'closed', code: e ? e.code : null, reason: e ? e.reason : '' });
              }
            };
          } catch (e) {
            notify('error', { error: 'Live WS init error: ' + (e.message || String(e)) });
          }
        };

        window.stopLiveStream = function() {
          if (isRecordingLive) {
            window.stopLiveRecording();
          }
          isStreamingRequested = false;
          reconnectAttempts = 0;
          if (liveWs) {
            try { liveWs.close(); } catch (_e) {}
            liveWs = null;
          }
          window.stopPcm();
        };

        var chunkIndex = 0;
        function playPcmArrayBuffer(arrayBuffer) {
          try {
            if (isRecordingLive && arrayBuffer && arrayBuffer.byteLength > 0) {
              recordedPcmChunks.push(arrayBuffer.slice(0));
            }
            initPcmContext();
            var len = arrayBuffer.byteLength;
            if (len < 2) return;
            var samplesCount = Math.floor(len / 2);
            var view = new DataView(arrayBuffer);
            var float32 = new Float32Array(samplesCount);
            for (var j = 0; j < samplesCount; j++) {
              var s = view.getInt16(j * 2, true);
              float32[j] = s / 32768.0;
            }

            var buffer = audioCtx.createBuffer(1, samplesCount, 16000);
            buffer.getChannelData(0).set(float32);

            var source = audioCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(gainNode || audioCtx.destination);

            var now = audioCtx.currentTime;
            if (nextPcmTime < now) {
              nextPcmTime = now + 0.02;
            } else if (nextPcmTime > now + 0.22) {
              // Clamp queue drift to 220ms max to prevent buffering repetitions
              nextPcmTime = now + 0.04;
            }
            source.start(nextPcmTime);
            nextPcmTime += buffer.duration;

            chunkIndex++;
            if (chunkIndex % 15 === 1) {
              notify('chunk_played', { count: chunkIndex, samples: samplesCount });
            }
          } catch (e) {
            notify('error', { error: 'PCM array decode error: ' + (e.message || String(e)) });
          }
        }

        window.playPcm = function(base64) {
          try {
            initPcmContext();
            var raw = atob(base64);
            var len = raw.length;
            if (len < 2) return;
            var bytes = new Uint8Array(len);
            for (var i = 0; i < len; i++) {
              bytes[i] = raw.charCodeAt(i);
            }
            playPcmArrayBuffer(bytes.buffer);
          } catch (e) {
            notify('error', { error: 'PCM play error: ' + (e.message || String(e)) });
          }
        };

        window.stopPcm = function() {
          if (audioCtx) {
            try { audioCtx.close(); } catch (_e) {}
            audioCtx = null;
            gainNode = null;
          }
          nextPcmTime = 0;
        };
      </script>
    </body>
    </html>
  `;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Active In-Bounds Audio Controller Engine */}
        <View style={{ width: 1, height: 1, opacity: 0.01, overflow: 'hidden' }}>
          <WebView
            ref={webViewRef}
            source={{ html: playerHtml, baseUrl: 'https://caretrack-backend-kv2n.onrender.com' }}
            onMessage={handleWebViewMessage}
            javaScriptEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            originWhitelist={['*']}
            mixedContentMode="always"
            domStorageEnabled
          />
        </View>

        <View style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleWrap}>
              <View style={styles.headerIconBadge}>
                <Icon name="radio-outline" size={20} color="#A855F7" />
              </View>
              <View>
                <Text style={styles.headerTitle}>Safety Snapshot</Text>
                <Text style={styles.headerSubtitle}>{child?.name || 'Child'}'s Surroundings</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Icon name="close" size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Feature Tabs (Extensible for Screen & Camera) */}
          <View style={styles.tabsRow}>
            <TouchableOpacity
              style={[styles.tabBtn, selectedTab === 'audio' && styles.tabBtnActive]}
              onPress={() => setSelectedTab('audio')}
              activeOpacity={0.8}
            >
              <Icon name="mic" size={16} color={selectedTab === 'audio' ? '#FFFFFF' : '#A855F7'} />
              <Text style={[styles.tabText, selectedTab === 'audio' && styles.tabTextActive]}>
                Surroundings
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, selectedTab === 'screen' && styles.tabBtnActive]}
              onPress={() => {
                stopPlayback();
                setSelectedTab('screen');
              }}
              activeOpacity={0.8}
            >
              <Icon name="phone-portrait-outline" size={16} color={selectedTab === 'screen' ? '#FFFFFF' : '#A855F7'} />
              <Text style={[styles.tabText, selectedTab === 'screen' && styles.tabTextActive]}>Screen</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, styles.tabBtnDisabled]}
              onPress={() => Alert.alert('Coming Soon', 'Remote Camera Capture is scheduled in the next platform update.')}
              activeOpacity={0.8}
            >
              <Icon name="camera-outline" size={16} color="#64748B" />
              <Text style={styles.tabTextDisabled}>Camera</Text>
              <View style={styles.soonBadge}>
                <Text style={styles.soonText}>SOON</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Action Area */}
          <View style={styles.actionCard}>
            {selectedTab === 'screen' ? (
              isCapturingScreen ? (
                <View style={styles.recordingState}>
                  <Animated.View style={[styles.recordingPulseRing, { transform: [{ scale: pulseAnim }], backgroundColor: 'rgba(168, 85, 247, 0.25)' }]}>
                    <View style={[styles.recordingInnerDot, { backgroundColor: '#7C3AED' }]}>
                      <Icon name="camera" size={26} color="#FFFFFF" />
                    </View>
                  </Animated.View>
                  <Text style={[styles.recordingTimerText, { color: '#C084FC' }]}>Capturing...</Text>
                  <Text style={styles.recordingStatusText}>Requesting silent screen capture...</Text>
                  <Text style={styles.recordingSubtext}>
                    Child device is capturing its active screen via Accessibility Service. Image will appear below shortly.
                  </Text>
                </View>
              ) : (
                <View style={styles.screenActionContainer}>
                  <View style={styles.screenActionHeader}>
                    <View style={styles.screenIconCircle}>
                      <Icon name="phone-portrait-outline" size={20} color="#A855F7" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.screenActionTitle}>Live Screen Capture</Text>
                      <Text style={styles.screenActionDesc}>
                        Silently captures the active screen of {child?.name || 'child'}'s phone in real time.
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.screenCaptureBtn}
                    onPress={handleTakeScreenshot}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={['#9333EA', '#7C3AED', '#4F46E5']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.screenCaptureBtnGradient}
                    >
                      <Icon name="camera-outline" size={19} color="#FFFFFF" style={{ marginRight: 8 }} />
                      <Text style={styles.screenCaptureBtnText}>Capture Child Screen Now</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              )
            ) : isLiveListening ? (
              <View style={styles.liveListeningCard}>
                <View style={styles.liveTopHeader}>
                  <View style={styles.liveBadgeRow}>
                    <View style={styles.liveRedDot} />
                    <Text style={styles.liveBadgeText}>LIVE AMBIENT STREAM</Text>
                  </View>
                  <View style={styles.liveTimerPill}>
                    <Icon name="time-outline" size={13} color="#F87171" style={{ marginRight: 4 }} />
                    <Text style={styles.liveTimerText}>
                      {Math.floor(liveElapsedTime / 60)}:{String(liveElapsedTime % 60).padStart(2, '0')}
                    </Text>
                  </View>
                </View>

                {/* Animated Sound Wave Equalizer */}
                <View style={styles.soundWaveRow}>
                  <Animated.View style={[styles.waveBar, { transform: [{ scaleY: waveAnim1 }] }]} />
                  <Animated.View style={[styles.waveBar, styles.waveBar2, { transform: [{ scaleY: waveAnim2 }] }]} />
                  <Animated.View style={[styles.waveBar, styles.waveBar3, { transform: [{ scaleY: waveAnim3 }] }]} />
                  <Animated.View style={[styles.waveBar, styles.waveBar4, { transform: [{ scaleY: waveAnim4 }] }]} />
                  <Animated.View style={[styles.waveBar, styles.waveBar5, { transform: [{ scaleY: waveAnim5 }] }]} />
                </View>

                <Text style={styles.liveSubText}>
                  {liveListenStatus === 'connecting'
                    ? 'Connecting live audio stream to device...'
                    : `Streaming surroundings from ${child?.name || 'child'}'s phone in real time`}
                </Text>

                <View style={styles.sameDeviceTipRow}>
                  <Icon name="headset-outline" size={13} color="#38BDF8" style={{ marginRight: 6 }} />
                  <Text style={styles.sameDeviceTipText}>
                    Testing on this same phone? Plug in earphones to prevent speaker-to-mic echo feedback.
                  </Text>
                </View>

                {/* Active Live Recording Status Banner */}
                {isRecordingLiveStream && (
                  <View style={styles.activeRecLivePill}>
                    <View style={styles.recordingPulseDot} />
                    <Text style={styles.activeRecLiveText}>
                      RECORDING SURROUNDINGS: {Math.floor(liveRecSeconds / 60)}:{String(liveRecSeconds % 60).padStart(2, '0')}
                    </Text>
                  </View>
                )}

                {/* Dual Action Controls: Record Live / Stop & Save + End Live Listen */}
                <View style={styles.liveActionBtnsRow}>
                  <TouchableOpacity
                    style={[styles.liveActionBtn, { flex: 1.25 }]}
                    onPress={isRecordingLiveStream ? handleStopLiveRecording : handleStartLiveRecording}
                    disabled={isSavingLiveClip || liveListenStatus === 'connecting'}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={
                        isSavingLiveClip
                          ? ['#475569', '#334155']
                          : isRecordingLiveStream
                          ? ['#059669', '#047857', '#065F46']
                          : ['#9333EA', '#7C3AED', '#6D28D9']
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.liveActionBtnGradient}
                    >
                      {isSavingLiveClip ? (
                        <>
                          <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 6 }} />
                          <Text style={styles.liveActionBtnText}>Saving Clip...</Text>
                        </>
                      ) : isRecordingLiveStream ? (
                        <>
                          <Icon name="save" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                          <Text style={styles.liveActionBtnText}>
                            Stop & Save ({liveRecSeconds}s)
                          </Text>
                        </>
                      ) : (
                        <>
                          <Icon name="radio" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                          <Text style={styles.liveActionBtnText}>Record Live</Text>
                        </>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.liveActionBtn, { flex: 0.95 }]}
                    onPress={handleStopLiveListen}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={['#DC2626', '#991B1B']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.liveActionBtnGradient}
                    >
                      <Icon name="stop" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.liveActionBtnText}>End Listen</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </View>
            ) : isRecording ? (
              <View style={styles.recordingState}>
                <Animated.View style={[styles.recordingPulseRing, { transform: [{ scale: pulseAnim }] }]}>
                  <View style={styles.recordingInnerDot}>
                    <Icon name="mic" size={28} color="#FFFFFF" />
                  </View>
                </Animated.View>
                <Text style={styles.recordingTimerText}>{countdown > 0 ? `${countdown}s` : 'Uploading...'}</Text>
                <Text style={styles.recordingStatusText}>
                  {countdown > 0 ? 'Recording surroundings check-in...' : 'Receiving audio clip from device...'}
                </Text>
                <Text style={styles.recordingSubtext}>
                  {countdown > 0
                    ? 'Child device is securely capturing audio. Clip will appear below shortly.'
                    : 'Child phone finished recording. Finalizing upload to safe storage...'}
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.durationSelectorRow}>
                  <Text style={styles.durationLabel}>Recording Duration:</Text>
                  <View style={styles.durationPills}>
                    {[15, 20, 30].map((dur) => (
                      <TouchableOpacity
                        key={dur}
                        style={[
                          styles.durationPill,
                          durationSeconds === dur && styles.durationPillActive,
                        ]}
                        onPress={() => setDurationSeconds(dur)}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.durationPillText,
                            durationSeconds === dur && styles.durationPillTextActive,
                          ]}
                        >
                          {dur}s
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.actionButtonsRow}>
                  <TouchableOpacity
                    style={[styles.actionBtnHalf, { flex: 1.25 }]}
                    onPress={handleStartCapture}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={['#9333EA', '#7C3AED', '#4F46E5']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.recordBtnGradient}
                    >
                      <Icon name="radio-outline" size={19} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.recordBtnText}>
                        Record ({durationSeconds}s)
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtnHalf, { flex: 1.1 }]}
                    onPress={handleStartLiveListen}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={['#EF4444', '#DC2626', '#B91C1C']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.liveBtnGradient}
                    >
                      <View style={styles.livePulseDot} />
                      <Icon name="pulse" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.liveBtnText}>Listen Live</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          {/* Past Recordings / Screen Snapshots Archive */}
          <View style={styles.historySectionHeader}>
            <View style={styles.historyHeaderLeft}>
              <Icon
                name={selectedTab === 'screen' ? 'images-outline' : 'folder-open-outline'}
                size={18}
                color="#C084FC"
              />
              <Text style={styles.historySectionTitle}>
                {selectedTab === 'screen' ? 'Past Screenshots' : 'Past Surroundings Clips'}
              </Text>
              <View style={styles.historyCountBadge}>
                <Text style={styles.historyCountText}>
                  {snapshots.filter((item) => {
                    if (selectedTab === 'screen') {
                      return (
                        item.media_type === 'screenshot' ||
                        item.file_name?.endsWith('.jpg') ||
                        item.file_name?.endsWith('.jpeg') ||
                        item.file_name?.endsWith('.png')
                      );
                    }
                    return (
                      item.media_type === 'audio' ||
                      item.media_type === 'live_listen' ||
                      item.file_name?.endsWith('.aac') ||
                      item.file_name?.endsWith('.wav') ||
                      item.file_name?.endsWith('.m4a')
                    );
                  }).length}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={loadHistory} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="refresh" size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.historyList} contentContainerStyle={styles.historyListContent}>
            {(() => {
              const filtered = snapshots.filter((item) => {
                if (selectedTab === 'screen') {
                  return (
                    item.media_type === 'screenshot' ||
                    item.file_name?.endsWith('.jpg') ||
                    item.file_name?.endsWith('.jpeg') ||
                    item.file_name?.endsWith('.png')
                  );
                }
                return (
                  item.media_type === 'audio' ||
                  item.media_type === 'live_listen' ||
                  item.file_name?.endsWith('.aac') ||
                  item.file_name?.endsWith('.wav') ||
                  item.file_name?.endsWith('.m4a')
                );
              });

              if (loadingHistory && filtered.length === 0) {
                return (
                  <View style={styles.emptyContainer}>
                    <ActivityIndicator size="small" color="#A855F7" />
                    <Text style={styles.emptyText}>
                      {selectedTab === 'screen' ? 'Loading past screenshots...' : 'Loading past recordings...'}
                    </Text>
                  </View>
                );
              }

              if (filtered.length === 0) {
                return (
                  <View style={styles.emptyContainer}>
                    <Icon
                      name={selectedTab === 'screen' ? 'image-outline' : 'musical-notes-outline'}
                      size={36}
                      color="#334155"
                    />
                    <Text style={styles.emptyText}>
                      {selectedTab === 'screen' ? 'No screenshots yet.' : 'No surroundings recordings yet.'}
                    </Text>
                    <Text style={styles.emptySubtext}>
                      {selectedTab === 'screen'
                        ? `Tap "Capture Child Screen Now" above to capture what ${child?.name || 'child'} is currently viewing.`
                        : `Tap "Record" above to listen to audio around ${child?.name || 'child'}'s phone.`}
                    </Text>
                  </View>
                );
              }

              if (selectedTab === 'screen') {
                return filtered.map((item) => {
                  const imgUrl = getSnapshotFileUrl(item.file_name);
                  const sizeKb = item.file_size_bytes ? `${Math.round(item.file_size_bytes / 1024)} KB` : '';
                  return (
                    <View key={item.id} style={styles.snapshotItemCard}>
                      <TouchableOpacity
                        onPress={() => {
                          if (!item.is_viewed) {
                            snapshotAPI.markViewed(item.id).catch(() => {});
                            setSnapshots((prev) =>
                              prev.map((s) => (s.id === item.id ? { ...s, is_viewed: true } : s))
                            );
                          }
                          setPreviewImage(item);
                        }}
                        activeOpacity={0.8}
                      >
                        <Image
                          source={{ uri: imgUrl }}
                          style={styles.screenshotThumb}
                          resizeMode="cover"
                        />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.itemInfoArea}
                        onPress={() => {
                          if (!item.is_viewed) {
                            snapshotAPI.markViewed(item.id).catch(() => {});
                            setSnapshots((prev) =>
                              prev.map((s) => (s.id === item.id ? { ...s, is_viewed: true } : s))
                            );
                          }
                          setPreviewImage(item);
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={styles.itemTitleRow}>
                          <Text style={styles.itemDateText}>{formatTimestamp(item.recorded_at)}</Text>
                          {!item.is_viewed && (
                            <View style={styles.unheardBadge}>
                              <Text style={styles.unheardText}>NEW</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.itemMetaText}>
                          Screen Capture {sizeKb ? `· ${sizeKb}` : ''}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.screenshotViewBtn}
                        onPress={() => {
                          if (!item.is_viewed) {
                            snapshotAPI.markViewed(item.id).catch(() => {});
                            setSnapshots((prev) =>
                              prev.map((s) => (s.id === item.id ? { ...s, is_viewed: true } : s))
                            );
                          }
                          setPreviewImage(item);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Icon name="eye-outline" size={18} color="#A855F7" />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.itemDeleteBtn}
                        onPress={() => handleDeleteSnapshot(item)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Icon name="trash-outline" size={17} color="#64748B" />
                      </TouchableOpacity>
                    </View>
                  );
                });
              }

              return filtered.map((item) => {
                const isSelected = activeSnapshot?.id === item.id;
                const isItemPlaying = isSelected && isPlaying;
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.snapshotItemCard,
                      isSelected && styles.snapshotItemCardActive,
                    ]}
                  >
                    <TouchableOpacity
                      style={[styles.itemPlayBtn, isItemPlaying && styles.itemPlayBtnPlaying]}
                      onPress={() => {
                        if (isSelected) {
                          togglePlayPause();
                        } else {
                          playSnapshot(item);
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <Icon
                        name={isItemPlaying ? 'pause' : 'play'}
                        size={18}
                        color={isItemPlaying ? '#FFFFFF' : '#A855F7'}
                      />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.itemInfoArea}
                      onPress={() => {
                        if (isSelected) {
                          togglePlayPause();
                        } else {
                          playSnapshot(item);
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={styles.itemTitleRow}>
                        <Text style={styles.itemDateText}>{formatTimestamp(item.recorded_at)}</Text>
                        {item.file_name?.includes('_live_') && (
                          <View style={styles.liveClipBadge}>
                            <Icon name="radio" size={9} color="#10B981" style={{ marginRight: 3 }} />
                            <Text style={styles.liveClipBadgeText}>LIVE CLIP</Text>
                          </View>
                        )}
                        {!item.is_viewed && (
                          <View style={styles.unheardBadge}>
                            <Text style={styles.unheardText}>NEW</Text>
                          </View>
                        )}
                        {isSelected && (
                          <View style={[styles.playingBadge, !isItemPlaying && styles.pausedBadge]}>
                            <Text style={styles.playingBadgeText}>
                              {isItemPlaying ? 'PLAYING' : 'PAUSED'}
                            </Text>
                          </View>
                        )}
                      </View>

                      {isSelected ? (
                        <View style={styles.inlinePlayerCol}>
                          <View style={styles.inlineTrack}>
                            <View
                              style={[
                                styles.inlineFill,
                                {
                                  width: `${Math.min(100, Math.max(0, audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0))}%`,
                                },
                              ]}
                            />
                          </View>
                          <View style={styles.inlineTimerRow}>
                            <Text style={styles.inlineTimerCurrent}>
                              0:{String(currentTime).padStart(2, '0')}
                            </Text>
                            <Text style={styles.inlineTimerTotal}>
                              0:{String(audioDuration || item.duration_seconds || 20).padStart(2, '0')}
                            </Text>
                          </View>
                        </View>
                      ) : (
                        <Text style={styles.itemMetaText}>
                          {item.file_name?.includes('_live_') ? 'Live Stream Recording' : 'Ambient Recording'} · {item.duration_seconds || 20}s
                        </Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.itemDeleteBtn}
                      onPress={() => handleDeleteSnapshot(item)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Icon name="trash-outline" size={17} color="#64748B" />
                    </TouchableOpacity>
                  </View>
                );
              });
            })()}
          </ScrollView>
        </View>
      </View>

      {/* Full-Screen Image Preview Modal with Permanent Delete Option */}
      <Modal
        visible={!!previewImage}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
      >
        <View style={styles.previewBackdrop}>
          <View style={styles.previewHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.previewTitle}>Child Screen Snapshot</Text>
              <Text style={styles.previewSubtitle}>
                {previewImage ? formatTimestamp(previewImage.recorded_at) : ''}
                {previewImage?.file_size_bytes ? ` · ${Math.round(previewImage.file_size_bytes / 1024)} KB` : ''}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.previewDeleteBtn}
              onPress={() => previewImage && handleDeleteSnapshot(previewImage)}
              activeOpacity={0.7}
            >
              <Icon name="trash-outline" size={20} color="#EF4444" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.previewCloseBtn}
              onPress={() => setPreviewImage(null)}
              activeOpacity={0.7}
            >
              <Icon name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.previewImageContainer}>
            {previewImage && (
              <Image
                source={{ uri: getSnapshotFileUrl(previewImage.file_name) }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}
          </View>

          <View style={styles.previewFooter}>
            <TouchableOpacity
              style={styles.previewBottomDeleteBtn}
              onPress={() => previewImage && handleDeleteSnapshot(previewImage)}
              activeOpacity={0.8}
            >
              <Icon name="trash-outline" size={17} color="#F87171" style={{ marginRight: 6 }} />
              <Text style={styles.previewBottomDeleteText}>Delete Screenshot</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(3, 7, 18, 0.75)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#0B1120',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '85%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontFamily: Fonts?.regular || 'sans-serif',
    fontSize: 12.5,
    color: '#94A3B8',
    marginTop: 1,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#131D33',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.25)',
    gap: 6,
  },
  tabBtnActive: {
    backgroundColor: '#7C3AED',
    borderColor: '#A855F7',
  },
  tabBtnDisabled: {
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
    opacity: 0.65,
  },
  tabText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 12.5,
    color: '#C084FC',
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontFamily: Fonts?.bold || 'sans-serif-bold',
  },
  tabTextDisabled: {
    fontFamily: Fonts?.regular || 'sans-serif',
    fontSize: 12,
    color: '#64748B',
  },
  soonBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  soonText: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#94A3B8',
  },
  actionCard: {
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
    marginBottom: 14,
  },
  durationSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  durationLabel: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 13,
    color: '#CBD5E1',
  },
  durationPills: {
    flexDirection: 'row',
    gap: 6,
  },
  durationPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
  },
  durationPillActive: {
    backgroundColor: '#7C3AED',
    borderColor: '#A855F7',
  },
  durationPillText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  durationPillTextActive: {
    color: '#FFFFFF',
  },
  recordBtnTouchable: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  actionBtnHalf: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  recordBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  recordBtnText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  liveBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  liveBtnText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    marginRight: 6,
  },
  liveListeningCard: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  liveTopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 14,
  },
  liveBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  liveRedDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#EF4444',
  },
  liveBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#EF4444',
    letterSpacing: 0.5,
  },
  liveTimerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
  },
  liveTimerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F87171',
  },
  soundWaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    gap: 8,
    marginVertical: 8,
  },
  waveBar: {
    width: 6,
    height: 36,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  waveBar2: {
    backgroundColor: '#F87171',
  },
  waveBar3: {
    backgroundColor: '#F43F5E',
  },
  waveBar4: {
    backgroundColor: '#FB7185',
  },
  waveBar5: {
    backgroundColor: '#E11D48',
  },
  liveSubText: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 10,
  },
  sameDeviceTipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sameDeviceTipText: {
    fontSize: 10.5,
    color: '#94A3B8',
    flex: 1,
    textAlign: 'center',
  },
  stopLiveBtn: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
  },
  stopLiveGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  stopLiveText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 14.5,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  activeRecLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.45)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 10,
    alignSelf: 'center',
  },
  recordingPulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    marginRight: 6,
  },
  activeRecLiveText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 11,
    color: '#FCA5A5',
    letterSpacing: 0.5,
  },
  liveActionBtnsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  liveActionBtn: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  liveActionBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    paddingHorizontal: 8,
  },
  liveActionBtnText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 13.5,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  liveClipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    marginLeft: 6,
  },
  liveClipBadgeText: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#34D399',
    letterSpacing: 0.4,
  },
  recordingState: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  recordingPulseRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  recordingInnerDot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingTimerText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 22,
    color: '#F87171',
    marginBottom: 2,
  },
  recordingStatusText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 14,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  recordingSubtext: {
    fontFamily: Fonts?.regular || 'sans-serif',
    fontSize: 11.5,
    color: '#94A3B8',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  playingBadge: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  pausedBadge: {
    backgroundColor: '#374151',
  },
  playingBadgeText: {
    fontSize: 7.5,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  inlinePlayerCol: {
    marginTop: 4,
    gap: 4,
  },
  inlineTrack: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  inlineFill: {
    height: '100%',
    backgroundColor: '#A855F7',
  },
  inlineTimerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inlineTimerCurrent: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#C084FC',
  },
  inlineTimerTotal: {
    fontSize: 10,
    color: '#94A3B8',
  },
  historySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  historyHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  historySectionTitle: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 13.5,
    color: '#E2E8F0',
  },
  historyCountBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
  },
  historyCountText: {
    fontSize: 10.5,
    color: '#C084FC',
    fontWeight: '700',
  },
  historyList: {
    maxHeight: 220,
  },
  historyListContent: {
    paddingBottom: 8,
  },
  snapshotItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
    padding: 10,
    marginBottom: 6,
    gap: 10,
  },
  snapshotItemCardActive: {
    borderColor: '#A855F7',
    backgroundColor: '#181028',
  },
  itemPlayBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1E1533',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemPlayBtnPlaying: {
    backgroundColor: '#7C3AED',
    borderColor: '#A855F7',
  },
  itemInfoArea: {
    flex: 1,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  itemDateText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 12.5,
    color: '#F1F5F9',
  },
  unheardBadge: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  unheardText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  itemMetaText: {
    fontFamily: Fonts?.regular || 'sans-serif',
    fontSize: 11,
    color: '#94A3B8',
  },
  itemDeleteBtn: {
    padding: 6,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 13,
    color: '#64748B',
    marginTop: 8,
  },
  emptySubtext: {
    fontFamily: Fonts?.regular || 'sans-serif',
    fontSize: 11.5,
    color: '#475569',
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 20,
  },
  screenActionContainer: {
    paddingVertical: 4,
  },
  screenActionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  screenIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenActionTitle: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 14.5,
    color: '#F8FAFC',
    marginBottom: 2,
  },
  screenActionDesc: {
    fontFamily: Fonts?.regular || 'sans-serif',
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 16,
  },
  screenCaptureBtn: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  screenCaptureBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  screenCaptureBtnText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  screenshotThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  screenshotViewBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(3, 7, 18, 0.95)',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 44 : 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    gap: 12,
  },
  previewTitle: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  previewSubtitle: {
    fontFamily: Fonts?.regular || 'sans-serif',
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  previewDeleteBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImageContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  previewImage: {
    width: SCREEN_WIDTH - 32,
    height: SCREEN_HEIGHT * 0.65,
    borderRadius: 12,
  },
  previewFooter: {
    paddingHorizontal: 20,
    paddingTop: 8,
    alignItems: 'center',
  },
  previewBottomDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: '100%',
  },
  previewBottomDeleteText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 13.5,
    color: '#F87171',
    fontWeight: '700',
  },
});
