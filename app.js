// 眼睛关键点索引（MediaPipe Face Mesh）
const LEFT_EYE_INDICES = [
    33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246
];

const RIGHT_EYE_INDICES = [
    362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398
];

// 虹膜/瞳孔关键点索引
const LEFT_IRIS_INDICES = [468, 469, 470, 471, 472];
const RIGHT_IRIS_INDICES = [473, 474, 475, 476, 477];

// 全局变量
let video, canvas, ctx;
let textCanvas, textCtx;
let faceMesh;
let isRunning = false;
let animationId;
let pane, startBtn;

// 配置参数
let params = {
    fillText: 'mitata',
    fontSize: 2,
    textColor: '#ffffff',
    scale: 10.0,
    maskSize: 1.0,
    eyeGap: 0
};

// 平滑处理的历史数据
let smoothingBuffer = {
    landmarks: [],
    maxSize: 8
};

// 初始化
async function init() {
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    textCanvas = document.getElementById('textCanvas');
    textCtx = textCanvas.getContext('2d');

    // 初始化 Tweakpane
    pane = new Tweakpane.Pane({
        container: document.getElementById('controls'),
        title: 'Controls'
    });

    pane.addInput(params, 'fillText', {
        label: '填充文本'
    });

    pane.addInput(params, 'fontSize', {
        label: '字体大小',
        min: 1,
        max: 20,
        step: 1
    });

    pane.addInput(params, 'textColor', {
        label: '文本颜色'
    });

    pane.addInput(params, 'scale', {
        label: '放大倍数',
        min: 1,
        max: 20,
        step: 0.1
    });

    pane.addInput(params, 'maskSize', {
        label: '瞳孔遮罩',
        min: 0,
        max: 2,
        step: 0.1
    });

    pane.addInput(params, 'eyeGap', {
        label: '眼睛间距',
        min: -200,
        max: 0,
        step: 1
    });

    startBtn = pane.addButton({
        title: '开始捕捉'
    }).on('click', () => {
        toggleCapture();
    });

    // F 键全屏切换
    document.addEventListener('keydown', (e) => {
        if (e.key === 'f' || e.key === 'F') {
            toggleFullscreen();
        }
    });

    // 初始化 Face Mesh
    await initFaceMesh();
}

// 初始化 MediaPipe Face Mesh
async function initFaceMesh() {
    try {
        updateStatus('正在加载模型...', 'loading');

        faceMesh = new FaceMesh({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
            }
        });

        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true, // 启用虹膜检测
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        faceMesh.onResults(onResults);

        updateStatus('模型加载完成，点击"开始捕捉"', 'ready');
    } catch (error) {
        console.error('Face Mesh 初始化失败:', error);
        updateStatus('模型加载失败: ' + error.message, 'error');
    }
}

// 开始/停止捕捉
async function toggleCapture() {
    if (!isRunning) {
        try {
            updateStatus('正在启动摄像头...', 'loading');

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720 }
            });

            video.srcObject = stream;
            await video.play();

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            isRunning = true;
            startBtn.title = '停止捕捉';
            updateStatus('正在捕捉...', 'ready');

            processFrame();
        } catch (error) {
            console.error('摄像头启动失败:', error);
            updateStatus('摄像头启动失败: ' + error.message, 'error');
        }
    } else {
        stopCapture();
        startBtn.title = '开始捕捉';
        updateStatus('已停止', 'ready');
    }
}

// 停止捕捉
function stopCapture() {
    isRunning = false;

    if (animationId) {
        cancelAnimationFrame(animationId);
    }

    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height);

    // 清空平滑缓冲区
    smoothingBuffer.landmarks = [];
}

// 处理视频帧
async function processFrame() {
    if (!isRunning) return;

    await faceMesh.send({ image: video });
    animationId = requestAnimationFrame(processFrame);
}

// 处理 Face Mesh 结果
function onResults(results) {
    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制视频帧
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];

        // 添加到平滑缓冲区
        smoothingBuffer.landmarks.push(landmarks);
        if (smoothingBuffer.landmarks.length > smoothingBuffer.maxSize) {
            smoothingBuffer.landmarks.shift();
        }

        // 计算平滑后的关键点
        const smoothedLandmarks = smoothLandmarks(smoothingBuffer.landmarks);

        // 绘制左眼文本填充
        drawEyeWithText(ctx, smoothedLandmarks, LEFT_EYE_INDICES, LEFT_IRIS_INDICES, canvas.width, canvas.height);

        // 绘制右眼文本填充
        drawEyeWithText(ctx, smoothedLandmarks, RIGHT_EYE_INDICES, RIGHT_IRIS_INDICES, canvas.width, canvas.height);

        // 在上半部分绘制放大的眼睛区域
        drawEnlargedEyeRegion(results.image, smoothedLandmarks);
    }
}

// 平滑关键点
function smoothLandmarks(landmarksHistory) {
    if (landmarksHistory.length === 0) return null;
    if (landmarksHistory.length === 1) return landmarksHistory[0];

    const smoothed = [];
    const numPoints = landmarksHistory[0].length;

    for (let i = 0; i < numPoints; i++) {
        let sumX = 0, sumY = 0, sumZ = 0;

        for (let j = 0; j < landmarksHistory.length; j++) {
            if (landmarksHistory[j][i]) {
                sumX += landmarksHistory[j][i].x;
                sumY += landmarksHistory[j][i].y;
                sumZ += landmarksHistory[j][i].z || 0;
            }
        }

        smoothed.push({
            x: sumX / landmarksHistory.length,
            y: sumY / landmarksHistory.length,
            z: sumZ / landmarksHistory.length
        });
    }

    return smoothed;
}

// 绘制眼睛文本填充（瞳孔留白）
function drawEyeWithText(context, landmarks, eyeIndices, irisIndices, canvasWidth, canvasHeight) {
    // 获取眼睛轮廓点
    const eyePoints = eyeIndices.map(idx => ({
        x: landmarks[idx].x * canvasWidth,
        y: landmarks[idx].y * canvasHeight
    }));

    // 获取虹膜/瞳孔点
    const irisPoints = irisIndices.map(idx => {
        if (landmarks[idx]) {
            return {
                x: landmarks[idx].x * canvasWidth,
                y: landmarks[idx].y * canvasHeight
            };
        }
        return null;
    }).filter(p => p !== null);

    // 计算眼睛边界
    const eyeBounds = getBounds(eyePoints);

    // 保存当前状态
    context.save();

    // 创建眼睛区域的裁剪路径
    context.beginPath();
    eyePoints.forEach((point, i) => {
        if (i === 0) {
            context.moveTo(point.x, point.y);
        } else {
            context.lineTo(point.x, point.y);
        }
    });
    context.closePath();
    context.clip();

    // 填充文本
    context.font = `${params.fontSize}px Arial`;
    context.fillStyle = params.textColor;

    const text = params.fillText || 'mitata';
    const lineHeight = params.fontSize * 1.2;

    // 在眼睛区域内填充文本（按字符）
    for (let y = eyeBounds.minY; y < eyeBounds.maxY; y += lineHeight) {
        let x = eyeBounds.minX;
        let charIndex = 0;

        while (x < eyeBounds.maxX) {
            const char = text[charIndex % text.length];
            const charWidth = context.measureText(char).width;

            // 检查是否在瞳孔区域内
            if (!isInIrisRegion(x, y, irisPoints)) {
                context.fillText(char, x, y);
            }

            x += charWidth + 1;
            charIndex++;
        }
    }

    context.restore();
}

// 获取点集的边界
function getBounds(points) {
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);

    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys)
    };
}

// 检查点是否在虹膜/瞳孔区域内
function isInIrisRegion(x, y, irisPoints) {
    if (irisPoints.length === 0) return false;

    // 计算虹膜中心
    const centerX = irisPoints.reduce((sum, p) => sum + p.x, 0) / irisPoints.length;
    const centerY = irisPoints.reduce((sum, p) => sum + p.y, 0) / irisPoints.length;

    // 计算虹膜半径（使用最远点的距离）
    const radius = Math.max(...irisPoints.map(p => {
        const dx = p.x - centerX;
        const dy = p.y - centerY;
        return Math.sqrt(dx * dx + dy * dy);
    }));

    // 应用遮罩大小调整
    const adjustedRadius = radius * params.maskSize;

    // 检查点是否在圆内
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return distance < adjustedRadius;
}

// 绘制放大的眼睛区域（只有文本，黑色背景）
function drawEnlargedEyeRegion(image, landmarks) {
    // 分别获取左右眼的关键点
    const leftEyePoints = LEFT_EYE_INDICES.map(idx => ({
        x: landmarks[idx].x * canvas.width,
        y: landmarks[idx].y * canvas.height
    }));

    const rightEyePoints = RIGHT_EYE_INDICES.map(idx => ({
        x: landmarks[idx].x * canvas.width,
        y: landmarks[idx].y * canvas.height
    }));

    // 计算左右眼的边界
    const leftEyeBounds = getBounds(leftEyePoints);
    const rightEyeBounds = getBounds(rightEyePoints);

    // 计算两眼中心点
    const leftEyeCenterX = (leftEyeBounds.minX + leftEyeBounds.maxX) / 2;
    const rightEyeCenterX = (rightEyeBounds.minX + rightEyeBounds.maxX) / 2;

    // 应用眼距调整（负值拉近，正值拉远）
    const gapAdjustment = -params.eyeGap / 2;

    // 计算整体区域边界（应用眼距调整）
    const adjustedLeftMaxX = leftEyeBounds.maxX + gapAdjustment;
    const adjustedRightMinX = rightEyeBounds.minX - gapAdjustment;

    const eyeRegionBounds = {
        minX: leftEyeBounds.minX,
        maxX: rightEyeBounds.maxX,
        minY: Math.min(leftEyeBounds.minY, rightEyeBounds.minY),
        maxY: Math.max(leftEyeBounds.maxY, rightEyeBounds.maxY)
    };

    // 添加边距
    const padding = 30;
    const sourceX = Math.max(0, eyeRegionBounds.minX - padding);
    const sourceY = Math.max(0, eyeRegionBounds.minY - padding);
    const sourceWidth = Math.min(canvas.width - sourceX, eyeRegionBounds.maxX - eyeRegionBounds.minX + padding * 2);
    const sourceHeight = Math.min(canvas.height - sourceY, eyeRegionBounds.maxY - eyeRegionBounds.minY + padding * 2);

    // 用离屏 canvas 以原始尺寸绘制文本效果
    const offscreen = document.createElement('canvas');
    offscreen.width = sourceWidth;
    offscreen.height = sourceHeight;
    const offCtx = offscreen.getContext('2d');

    offCtx.fillStyle = '#000';
    offCtx.fillRect(0, 0, sourceWidth, sourceHeight);

    drawEyeWithTextScaled(offCtx, landmarks, LEFT_EYE_INDICES, LEFT_IRIS_INDICES,
        canvas.width, canvas.height, 1, sourceX, sourceY, gapAdjustment);
    drawEyeWithTextScaled(offCtx, landmarks, RIGHT_EYE_INDICES, RIGHT_IRIS_INDICES,
        canvas.width, canvas.height, 1, sourceX, sourceY, -gapAdjustment);

    // 将离屏 canvas 缩放绘制到 textCanvas
    const displayW = document.querySelector('.text-display').clientWidth;
    const displayH = document.querySelector('.text-display').clientHeight;
    const aspect = sourceWidth / sourceHeight;
    let drawW = displayW;
    let drawH = displayW / aspect;
    if (drawH > displayH) {
        drawH = displayH;
        drawW = displayH * aspect;
    }

    textCanvas.width = displayW;
    textCanvas.height = displayH;
    textCtx.fillStyle = '#000';
    textCtx.fillRect(0, 0, displayW, displayH);

    const drawX = (displayW - drawW) / 2;
    const drawY = (displayH - drawH) / 2;
    textCtx.imageSmoothingEnabled = false;
    textCtx.drawImage(offscreen, drawX, drawY, drawW * params.scale / 10, drawH * params.scale / 10);
}

// 在缩放的画布上绘制眼睛文本填充
function drawEyeWithTextScaled(context, landmarks, eyeIndices, irisIndices,
    originalWidth, originalHeight, scale, offsetX, offsetY, gapAdjustment = 0) {

    // 获取眼睛轮廓点（转换到缩放后的坐标系统，应用眼距调整）
    const eyePoints = eyeIndices.map(idx => ({
        x: (landmarks[idx].x * originalWidth + gapAdjustment - offsetX) * scale,
        y: (landmarks[idx].y * originalHeight - offsetY) * scale
    }));

    // 获取虹膜/瞳孔点（转换到缩放后的坐标系统，应用眼距调整）
    const irisPoints = irisIndices.map(idx => {
        if (landmarks[idx]) {
            return {
                x: (landmarks[idx].x * originalWidth + gapAdjustment - offsetX) * scale,
                y: (landmarks[idx].y * originalHeight - offsetY) * scale
            };
        }
        return null;
    }).filter(p => p !== null);

    // 计算眼睛边界
    const eyeBounds = getBounds(eyePoints);

    // 保存当前状态
    context.save();

    // 创建眼睛区域的裁剪路径
    context.beginPath();
    eyePoints.forEach((point, i) => {
        if (i === 0) {
            context.moveTo(point.x, point.y);
        } else {
            context.lineTo(point.x, point.y);
        }
    });
    context.closePath();
    context.clip();

    // 填充文本（字体大小也需要缩放）
    const scaledFontSize = params.fontSize * scale;
    context.font = `${scaledFontSize}px Arial`;
    context.fillStyle = params.textColor;

    const text = params.fillText || 'mitata';
    const lineHeight = scaledFontSize * 1.2;

    // 在眼睛区域内填充文本（按字符）
    for (let y = eyeBounds.minY; y < eyeBounds.maxY; y += lineHeight) {
        let x = eyeBounds.minX;
        let charIndex = 0;

        while (x < eyeBounds.maxX) {
            const char = text[charIndex % text.length];
            const charWidth = context.measureText(char).width;

            // 检查是否在瞳孔区域内
            if (!isInIrisRegion(x, y, irisPoints)) {
                context.fillText(char, x, y);
            }

            x += charWidth + 1;
            charIndex++;
        }
    }

    context.restore();
}

// 更新状态显示
function updateStatus(message, type) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
}

// F 键全屏切换
function toggleFullscreen() {
    const textDisplay = document.querySelector('.text-display');
    textDisplay.classList.toggle('fullscreen');
}

// 页面加载完成后初始化
window.addEventListener('load', init);
