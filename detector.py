"""YOLO11 inference on ONNX Runtime.

This replaces ultralytics/torch, which needs ~400MB resident and cannot fit in a
512MB instance. onnxruntime runs the exact same exported model in a fraction of
that, at the cost of doing the pre/post-processing ourselves — which is what the
rest of this file is.
"""
import cv2
import numpy as np
import onnxruntime as ort

COCO_NAMES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
    "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
    "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
    "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
    "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup",
    "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier",
    "toothbrush",
]


def _letterbox(image, size):
    """Resizes preserving aspect ratio, padding the remainder to a square."""
    h, w = image.shape[:2]
    ratio = min(size / h, size / w)
    new_w, new_h = int(round(w * ratio)), int(round(h * ratio))

    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    pad_x = (size - new_w) // 2
    pad_y = (size - new_h) // 2
    canvas[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = cv2.resize(
        image, (new_w, new_h), interpolation=cv2.INTER_LINEAR
    )
    return canvas, ratio, pad_x, pad_y


def _nms(boxes, scores, iou_threshold):
    """Greedy non-max suppression. Returns indices to keep, highest score first."""
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]

    keep = []
    while order.size > 0:
        current = order[0]
        keep.append(current)
        if order.size == 1:
            break

        rest = order[1:]
        inter_w = np.maximum(0.0, np.minimum(x2[current], x2[rest]) - np.maximum(x1[current], x1[rest]))
        inter_h = np.maximum(0.0, np.minimum(y2[current], y2[rest]) - np.maximum(y1[current], y1[rest]))
        intersection = inter_w * inter_h
        iou = intersection / (areas[current] + areas[rest] - intersection + 1e-9)

        order = rest[iou <= iou_threshold]

    return keep


class Detector:
    def __init__(self, model_path, conf_threshold=0.25, iou_threshold=0.45):
        options = ort.SessionOptions()
        # A small instance has a fraction of a CPU; extra threads only add
        # contention and memory here.
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1

        self.session = ort.InferenceSession(
            model_path, sess_options=options, providers=["CPUExecutionProvider"]
        )
        self.input_name = self.session.get_inputs()[0].name
        self.input_size = self.session.get_inputs()[0].shape[2]  # 640
        self.conf_threshold = conf_threshold
        self.iou_threshold = iou_threshold

    def detect(self, frame):
        """Runs detection on a BGR frame.

        Returns a list of {name, confidence, box}, where box is [x1, y1, x2, y2]
        normalized to 0..1 against the original frame, so the browser can draw it
        at whatever size it is rendering the video.
        """
        img_h, img_w = frame.shape[:2]
        padded, ratio, pad_x, pad_y = _letterbox(frame, self.input_size)

        blob = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        blob = np.ascontiguousarray(blob.transpose(2, 0, 1)[None])  # NCHW

        outputs = self.session.run(None, {self.input_name: blob})

        # (1, 84, 8400) -> (8400, 84): 4 box coords then 80 class scores.
        predictions = outputs[0][0].T
        class_scores = predictions[:, 4:]
        class_ids = class_scores.argmax(axis=1)
        confidences = class_scores[np.arange(len(class_scores)), class_ids]

        keep_mask = confidences > self.conf_threshold
        if not keep_mask.any():
            return []

        boxes_cxcywh = predictions[keep_mask, :4]
        confidences = confidences[keep_mask]
        class_ids = class_ids[keep_mask]

        # cxcywh -> xyxy, still in letterboxed 640x640 space.
        cx, cy, w, h = boxes_cxcywh.T
        boxes = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)

        # Undo the letterbox to get back to original frame pixels.
        boxes[:, [0, 2]] = (boxes[:, [0, 2]] - pad_x) / ratio
        boxes[:, [1, 3]] = (boxes[:, [1, 3]] - pad_y) / ratio
        boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, img_w)
        boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, img_h)

        # NMS per class: offsetting each class into its own coordinate band means
        # boxes of different classes can never suppress one another.
        offsets = class_ids[:, None] * (max(img_w, img_h) + 1)
        keep = _nms(boxes + offsets, confidences, self.iou_threshold)

        results = []
        for i in keep:
            x1, y1, x2, y2 = boxes[i]
            results.append({
                "name": COCO_NAMES[class_ids[i]],
                "confidence": round(float(confidences[i]), 2),
                "box": [
                    round(float(x1 / img_w), 4),
                    round(float(y1 / img_h), 4),
                    round(float(x2 / img_w), 4),
                    round(float(y2 / img_h), 4),
                ],
            })
        return results
