require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: ["http://localhost:5173", "https://restocontrol.surge.sh"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.okdmlp6.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "not authorized" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "not authorized" });
    }
    req.user = decoded;
  });
  next();
};
const verifyAdmin = async (req, res, next) => {
  const email = req.user?.email;
  const query = { email: email };
  const user = await userCollection.findOne(query);
  const isAdmin = user?.role === "admin";
  if (!isAdmin) {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};

async function run() {
  try {
    const aboutUsCollection = client
      .db("RestaurantManage")
      .collection("aboutUs");
    const reviewCollection = client
      .db("RestaurantManage")
      .collection("reviews");
    const userCollection = client.db("ContestHubDB").collection("Users");
    const contestCollection = client.db("ContestHubDB").collection("Contests");
    const creatorCollection = client.db("ContestHubDB").collection("Creators");

    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1hr",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production" ? true : false,
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    app.post("/logout", async (req, res) => {
      const user = req.body;
      res
        .clearCookie("token", {
          maxAge: 0,
          secure: process.env.NODE_ENV === "production" ? true : false,
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    app.get("/review", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    app.get("/AboutUs", async (req, res) => {
      const result = await aboutUsCollection.find().toArray();
      res.send(result);
    });

    app.get("/details/:id", verifyToken, async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      const result = await contestCollection.findOne(query);
      res.send(result);
    });
    app.get("/searchContest", async (req, res) => {
      try {
        const query = req.query.q;
        if (!query) {
          res.send([]);
          return;
        }
        const result = await contestCollection
          .find({ category: { $regex: query, $options: "i" } })
          .toArray();
        res.send(result);
      } catch (error) {
        console.log(error);
      }
    });

    app.get("/contests", async (req, res) => {
      const result = await contestCollection.find().toArray();
      res.send(result);
    });

    app.get("/popularContest", async (req, res) => {
      try {
        const result = await contestCollection
          .find()
          .sort({ participant: -1 })
          .limit(6)
          .toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
      }
    });

    app.get("/contestWinner", async (req, res) => {
      try {
        const result = await contestCollection
          .find({ winner_name: { $exists: true, $ne: null } })
          .project({
            _id: 1,
            img: 1,
            name: 1,
            category: 1,
            prize: 1,
            winner_name: 1,
            winner_img: 1,
          })
          .toArray();

        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        const query = { email: user.email };
        const isExist = await userCollection.findOne(query);
        if (isExist) {
          return res.send({ message: "user exists", insertedId: null });
        }
        const result = await userCollection.insertOne(user);
        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).json({ error: "Internal server error" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("server is running");
});

app.listen(port, () => {
  console.log(`server is running on port ${port}`);
});
