import json
from quart import Quart
from quart_cors import cors

app = Quart(__name__)
app = cors(app, allow_origin="http://57.129.44.194:3001")

@app.route("/api/test")
def hello_world():
    return json.dumps("Hello World!")

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5001)
