import numpy as np
from ultralytics import YOLO


class YOLODetector:
    def __init__(self, model_path="yolo11n.pt"):
        """
        Class for object detection using YOLO11n model

        Args:
            model_path (str): Path to YOLO model
        """
        self.model = YOLO(model_path)

    def detect(self, image: np.ndarray) -> np.ndarray:
        """
        Perform object detection on an image and return detection results

        Args:
            image (np.ndarray): Input image as numpy array in (H, W, C) format

        Returns:
            np.ndarray: Detection results as numpy array
        """
        # Run inference with YOLO model
        results = self.model(image)

        # Convert detection results to numpy array
        detections = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                # Get bounding box coordinates, confidence, and class ID
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                conf = box.conf[0].cpu().numpy()
                cls = box.cls[0].cpu().numpy()

                detections.append([x1, y1, x2, y2, conf, cls])

        return np.array(detections)
