import React, { useEffect, useState } from "react";

function App() {
  const [data, setData] = useState("");

  useEffect(() => {
    fetch("http://57.129.44.194:5001/api/test")
      .then(r => r.json()).then(setData)
    }, []);

  return (
    <div className="App">{data}</div>
  );
}

export default App;
