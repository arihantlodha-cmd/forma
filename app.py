import os
import base64
from flask import Flask, request, jsonify, send_from_directory
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder=".", static_url_path="")

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

SYSTEM_PROMPT = (
    "You are Forma, a spatial reasoning AI. When given an image and a question, "
    "you analyze the spatial relationships, geometry, dimensions, and physical structure "
    "in the image. Always respond with numbered steps that walk through your reasoning. "
    "Be clear, educational, and precise. Never just give the final answer — always show "
    "the spatial thinking behind it."
)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}
MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/analyze", methods=["POST"])
def analyze():
    # Validate image
    if "image" not in request.files:
        return jsonify({"error": "No image file provided."}), 400

    image_file = request.files["image"]
    if image_file.filename == "":
        return jsonify({"error": "Empty filename."}), 400

    if not allowed_file(image_file.filename):
        return jsonify({"error": "Unsupported file type. Use PNG, JPG, WEBP, or GIF."}), 400

    image_bytes = image_file.read()
    if len(image_bytes) > MAX_IMAGE_BYTES:
        return jsonify({"error": "Image too large. Maximum size is 20 MB."}), 400

    # Validate question
    question = request.form.get("question", "").strip()
    if not question:
        return jsonify({"error": "No question provided."}), 400

    # Determine MIME type
    ext = image_file.filename.rsplit(".", 1)[1].lower()
    mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg",
                "png": "image/png", "webp": "image/webp", "gif": "image/gif"}
    mime_type = mime_map.get(ext, "image/jpeg")

    # Encode image as base64
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:{mime_type};base64,{image_b64}"

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url, "detail": "high"},
                        },
                        {"type": "text", "text": question},
                    ],
                },
            ],
            max_tokens=1500,
        )
        answer = response.choices[0].message.content
        return jsonify({"answer": answer})

    except Exception as e:
        error_msg = str(e)
        # Provide a cleaner message for common API errors
        if "api_key" in error_msg.lower() or "authentication" in error_msg.lower():
            error_msg = "Invalid or missing OpenAI API key. Check your .env file."
        elif "quota" in error_msg.lower() or "billing" in error_msg.lower():
            error_msg = "OpenAI quota exceeded. Check your account billing."
        return jsonify({"error": error_msg}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=os.environ.get("FLASK_DEBUG", "false").lower() == "true", port=port)
