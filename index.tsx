import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Settings, Trash2, AlertCircle, Zap } from 'lucide-react';

export default function RealtimeSpeechRecognition() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [workerUrl, setWorkerUrl] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState('准备就绪');
  const [language, setLanguage] = useState('zh');
  const [segmentMode, setSegmentMode] = useState('smart'); // 'time' or 'smart'
  const [chunkDuration, setChunkDuration] = useState(3000);
  const [silenceThreshold, setSilenceThreshold] = useState(0.01);
  const [silenceDuration, setSilenceDuration] = useState(800);
  const [maxSegmentDuration, setMaxSegmentDuration] = useState(10000);
  const [volumeLevel, setVolumeLevel] = useState(0);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const chunkTimerRef = useRef(null);
  const streamRef = useRef(null);
  const processingRef = useRef(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const segmentStartTimeRef = useRef(0);
  const lastSpeechTimeRef = useRef(0);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    const savedUrl = localStorage.getItem('worker_url');
    const savedLang = localStorage.getItem('language');
    const savedMode = localStorage.getItem('segment_mode');
    if (savedUrl) setWorkerUrl(savedUrl);
    if (savedLang) setLanguage(savedLang);
    if (savedMode) setSegmentMode(savedMode);
  }, []);

  const saveWorkerUrl = (url) => {
    setWorkerUrl(url);
    localStorage.setItem('worker_url', url);
  };

  const saveLanguage = (lang) => {
    setLanguage(lang);
    localStorage.setItem('language', lang);
  };

  const saveSegmentMode = (mode) => {
    setSegmentMode(mode);
    localStorage.setItem('segment_mode', mode);
  };

  // 计算音频音量
  const calculateVolume = () => {
    if (!analyserRef.current) return 0;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    const sum = dataArray.reduce((a, b) => a + b, 0);
    const average = sum / dataArray.length;
    return average / 255; // 归一化到 0-1
  };

  // 监控音量
  const monitorVolume = () => {
    if (!isRecording) return;
    
    const volume = calculateVolume();
    setVolumeLevel(volume);
    
    // 智能分段模式：检测静默
    if (segmentMode === 'smart') {
      const now = Date.now();
      
      if (volume > silenceThreshold) {
        // 有声音
        lastSpeechTimeRef.current = now;
        
        // 检查是否超过最大时长
        if (now - segmentStartTimeRef.current > maxSegmentDuration) {
          triggerSegment('达到最大时长');
        }
      } else {
        // 静默
        const silenceTime = now - lastSpeechTimeRef.current;
        
        // 如果静默超过阈值，且有录音内容
        if (silenceTime > silenceDuration && audioChunksRef.current.length > 0) {
          triggerSegment('检测到静默');
        }
      }
    }
    
    animationFrameRef.current = requestAnimationFrame(monitorVolume);
  };

  // 触发分段
  const triggerSegment = (reason) => {
    if (processingRef.current) return;
    
    console.log('分段原因:', reason);
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      processAudioChunk();
      
      // 重新开始录音
      setTimeout(() => {
        if (streamRef.current && isRecording) {
          startNewSegment();
        }
      }, 50);
    }
  };

  // 开始新的录音段
  const startNewSegment = () => {
    const newRecorder = new MediaRecorder(streamRef.current, {
      mimeType: 'audio/webm;codecs=opus',
    });
    
    newRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };
    
    mediaRecorderRef.current = newRecorder;
    newRecorder.start();
    segmentStartTimeRef.current = Date.now();
    lastSpeechTimeRef.current = Date.now();
  };

  // 发送音频到 Cloudflare Worker
  const transcribeAudio = async (audioBlob) => {
    if (!workerUrl) {
      setStatus('错误：请先设置 Worker URL');
      return;
    }

    if (processingRef.current) return;

    try {
      processingRef.current = true;
      setStatus('识别中...');
      
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      formData.append('language', language);

      const response = await fetch(workerUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || '识别失败');
      }

      const result = await response.json();
      
      if (result.text && result.text.trim()) {
        const newEntry = {
          id: Date.now(),
          text: result.text,
          timestamp: new Date().toLocaleTimeString('zh-CN'),
          mode: segmentMode,
        };
        setTranscript(prev => [...prev, newEntry]);
        setStatus(isRecording ? '正在录音...' : '识别成功');
      } else {
        setStatus(isRecording ? '正在录音...' : '无声音');
      }
    } catch (error) {
      console.error('转录错误:', error);
      setStatus(`错误: ${error.message}`);
    } finally {
      processingRef.current = false;
    }
  };

  // 处理音频块
  const processAudioChunk = () => {
    if (audioChunksRef.current.length === 0) return;

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    audioChunksRef.current = [];
    
    transcribeAudio(audioBlob);
  };

  // 开始录音
  const startRecording = async () => {
    if (!workerUrl) {
      setStatus('错误：请先在设置中配置 Worker URL');
      setShowSettings(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      
      streamRef.current = stream;
      
      // 初始化音频分析器（用于音量检测）
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      analyserRef.current.smoothingTimeConstant = 0.8;
      source.connect(analyserRef.current);
      
      // 开始第一段录音
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      segmentStartTimeRef.current = Date.now();
      lastSpeechTimeRef.current = Date.now();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatus('正在录音...');

      // 开始音量监控
      monitorVolume();

      // 如果是时间模式，使用定时器
      if (segmentMode === 'time') {
        chunkTimerRef.current = setInterval(() => {
          triggerSegment('定时分段');
        }, chunkDuration);
      }

    } catch (error) {
      console.error('录音错误:', error);
      setStatus(`错误: ${error.message}`);
    }
  };

  // 停止录音
  const stopRecording = () => {
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      processAudioChunk();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    setIsRecording(false);
    setVolumeLevel(0);
    setStatus('已停止');
  };

  // 清空转录
  const clearTranscript = () => {
    setTranscript([]);
    setStatus('已清空');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-4">
      <div className="max-w-4xl mx-auto">
        {/* 头部 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                智能语音识别
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {segmentMode === 'smart' ? '🎯 智能分段模式' : '⏱️ 定时分段模式'}
              </p>
            </div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Settings className="w-6 h-6 text-gray-600" />
            </button>
          </div>

          {/* 音量指示器 */}
          {isRecording && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">音量</span>
                <span className="text-xs text-gray-500">
                  {volumeLevel > silenceThreshold ? '🎤 说话中' : '🔇 静默中'}
                </span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all duration-100"
                  style={{ width: `${volumeLevel * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* 设置面板 */}
          {showSettings && (
            <div className="mb-4 p-4 bg-gray-50 rounded-xl space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Cloudflare Worker URL
                </label>
                <input
                  type="text"
                  value={workerUrl}
                  onChange={(e) => saveWorkerUrl(e.target.value)}
                  placeholder="https://your-worker.your-subdomain.workers.dev"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  识别语言
                </label>
                <select
                  value={language}
                  onChange={(e) => saveLanguage(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                  <Zap className="w-4 h-4 mr-1 text-yellow-500" />
                  分段模式
                </label>
                <div className="space-y-2">
                  <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-blue-50">
                    <input
                      type="radio"
                      value="smart"
                      checked={segmentMode === 'smart'}
                      onChange={(e) => saveSegmentMode(e.target.value)}
                      className="mr-3"
                    />
                    <div>
                      <div className="font-medium">智能分段（推荐）</div>
                      <div className="text-xs text-gray-500">根据说话停顿自动分段</div>
                    </div>
                  </label>
                  <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-blue-50">
                    <input
                      type="radio"
                      value="time"
                      checked={segmentMode === 'time'}
                      onChange={(e) => saveSegmentMode(e.target.value)}
                      className="mr-3"
                    />
                    <div>
                      <div className="font-medium">定时分段</div>
                      <div className="text-xs text-gray-500">固定时间间隔分段</div>
                    </div>
                  </label>
                </div>
              </div>

              {segmentMode === 'smart' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      静默阈值: {(silenceThreshold * 100).toFixed(1)}%
                    </label>
                    <input
                      type="range"
                      min="0.005"
                      max="0.05"
                      step="0.005"
                      value={silenceThreshold}
                      onChange={(e) => setSilenceThreshold(Number(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">低于此音量视为静默</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      静默等待: {silenceDuration}ms
                    </label>
                    <input
                      type="range"
                      min="500"
                      max="2000"
                      step="100"
                      value={silenceDuration}
                      onChange={(e) => setSilenceDuration(Number(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">静默多久后触发分段</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      最大分段: {maxSegmentDuration / 1000}秒
                    </label>
                    <input
                      type="range"
                      min="5000"
                      max="15000"
                      step="1000"
                      value={maxSegmentDuration}
                      onChange={(e) => setMaxSegmentDuration(Number(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">单段最长录音时间</p>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    分段时长: {chunkDuration / 1000}秒
                  </label>
                  <input
                    type="range"
                    min="2000"
                    max="8000"
                    step="1000"
                    value={chunkDuration}
                    onChange={(e) => setChunkDuration(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}
            </div>
          )}

          {/* 状态显示 */}
          <div className="flex items-center justify-center space-x-4">
            <div className={`px-4 py-2 rounded-full text-sm font-medium ${
              isRecording 
                ? 'bg-red-100 text-red-700' 
                : 'bg-gray-100 text-gray-700'
            }`}>
              {status}
            </div>
          </div>
        </div>

        {/* 控制按钮 */}
        <div className="bg-white rounded-2xl shadow-lg p-8 mb-6">
          <div className="flex items-center justify-center space-x-4">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!workerUrl}
              className={`p-6 rounded-full transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                isRecording
                  ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-200'
                  : 'bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-200'
              }`}
            >
              {isRecording ? (
                <MicOff className="w-8 h-8 text-white" />
              ) : (
                <Mic className="w-8 h-8 text-white" />
              )}
            </button>

            <button
              onClick={clearTranscript}
              disabled={transcript.length === 0}
              className="p-4 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:opacity-50 rounded-full transition-colors"
            >
              <Trash2 className="w-6 h-6 text-gray-600" />
            </button>
          </div>

          <p className="text-center text-gray-600 mt-4">
            {isRecording ? '点击停止录音' : workerUrl ? '点击开始录音' : '请先配置 Worker URL'}
          </p>
        </div>

        {/* 转录结果 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">转录结果</h2>
          
          {transcript.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              暂无转录内容
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {transcript.map((entry) => (
                <div
                  key={entry.id}
                  className="p-4 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl border border-blue-100"
                >
                  <div className="flex items-start justify-between">
                    <p className="text-gray-800 flex-1">{entry.text}</p>
                    <span className="text-xs text-gray-500 ml-4 whitespace-nowrap">
                      {entry.timestamp}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 说明 */}
        <div className="mt-6 p-4 bg-green-50 rounded-xl border border-green-200">
          <div className="flex items-start space-x-3">
            <Zap className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-green-900 mb-2">智能分段原理</h3>
              <div className="text-sm text-green-800 space-y-1">
                <p><strong>智能模式：</strong>检测说话停顿，在自然断句处分段</p>
                <p><strong>定时模式：</strong>固定时间间隔分段（可能打断句子）</p>
                <p><strong>优势：</strong>更连贯的识别结果，减少无效 API 调用</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}