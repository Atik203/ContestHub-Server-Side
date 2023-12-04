require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const app = express();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_KEY);

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
const aboutUsCollection = client.db("ContestHubDB").collection("AboutUs");
const reviewCollection = client.db("RestaurantManage").collection("reviews");
const userCollection = client.db("ContestHubDB").collection("Users");
const contestCollection = client.db("ContestHubDB").collection("ContestDB");
const creatorCollection = client.db("ContestHubDB").collection("Creators");
const leadersCollection = client.db("ContestHubDB").collection("LeaderBoards");
const paymentCollection = client.db("ContestHubDB").collection("PaymentDB");

async function run() {
  try {
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

    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;

      if (!price || isNaN(parseInt(price))) {
        return res.status(400).send({ error: "Invalid price value" });
      }
      const amount = parseInt(price) * 100;
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).send({ error: "Invalid amount value" });
      }
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error("Stripe error:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    app.post("/payment", async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);
      res.send(result);
    });

    app.get("/payment/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/all-participant", verifyToken, async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });
    app.patch("/setWinner/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const winner = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          winner_name: winner.name,
        },
      };
      const result = await paymentCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.get("/registered/:contestId", async (req, res) => {
      const contestId = parseInt(req.params.contestId);
      if (!contestId) {
        return res.status(404);
      }
      const query = { contestId: contestId };
      const result = await paymentCollection.findOne(query);
      let registered = false;

      if (result?.contestId === contestId) {
        registered = true;
      }
      res.send({ registered });
    });

    app.get("/AboutUs", async (req, res) => {
      const result = await aboutUsCollection.find().toArray();
      res.send(result);
    });

    app.get("/leaderboard", async (req, res) => {
      const result = await leadersCollection.find().toArray();
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

    app.get("/singleContest/:id", async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };

      const result = await creatorCollection.findOne(query);

      res.send(result);
    });

    app.get("/contestData", async (req, res) => {
      const contestId = parseInt(req.query.contestId);
      const query = { contestId: contestId };
      const result = await contestCollection.findOne(query);
      res.send(result);
    });

    app.get("/contests", async (req, res) => {
      const result = await contestCollection.find().toArray();
      res.send(result);
    });

    app.post("/AddContest", async (req, res) => {
      const query = req.body;

      const result = await contestCollection.insertOne(query);
      res.send(result);
    });

    app.post("/AddCreatorContest", async (req, res) => {
      const query = req.body;

      const result = await creatorCollection.insertOne(query);
      res.send(result);
    });

    app.get("/creator", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await creatorCollection.find(query).toArray();
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

    app.get("/bestCreator", async (req, res) => {
      try {
        const result = await creatorCollection
          .find()
          .sort({ participant: -1 })
          .limit(3)
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

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (email !== req.user?.email) {
          return res.status(403).send({ message: "unauthorized" });
        }
        const query = { email: email };
        const user = await userCollection.findOne(query);
        let admin = "normal";
        if (user) {
          admin = user.role || admin;
        }

        res.send({ admin });
      } catch (error) {
        console.log(error);
      }
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });
    app.delete("/contest/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await contestCollection.deleteOne(query);
      res.send(result);
    });

    app.patch("/updateContest/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const ContestData = req.body;

        const filter = { _id: new ObjectId(id) };
        const update = {
          $set: {
            name: ContestData.name,
            img: ContestData.img,
            prize: ContestData.prize,
            category: ContestData.category,
            description: ContestData.description,
            deadline: ContestData.deadline,
            instruction: ContestData.instruction,
          },
        };
        const result = await contestCollection.updateOne(filter, update);
        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.patch("/updateCreatorContest/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const ContestData = req.body;

        const filter = { _id: new ObjectId(id) };
        const update = {
          $set: {
            name: ContestData.name,
            img: ContestData.img,
            prize: ContestData.prize,
            category: ContestData.category,
            description: ContestData.description,
            deadline: ContestData.deadline,
            instruction: ContestData.instruction,
          },
        };
        const result = await creatorCollection.updateOne(filter, update);
        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.patch("/contest/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params;

      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          Confirm: "confirmed",
        },
      };
      const result = await contestCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.patch(
      "/creator/:contestId",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const contestId = parseInt(req.params.contestId);
        const query = { contestId: contestId };
        const updatedDoc = {
          $set: {
            Confirm: "confirmed",
          },
        };
        const result = await creatorCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );
    app.patch("/updateProfile/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const data = req.body;

      const query = { email: email };
      const updateDoc = {
        $set: {
          name: data.displayName,
          photo: data.photoURL,
        },
      };
      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.get("/user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await userCollection.findOne(query);

      res.send(result);
    });

    app.get("/userStats/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.patch("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params;
      const { role } = req.body;

      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: role,
        },
      };

      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
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
