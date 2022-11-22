const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); 
const app = express();
const port = process.env.PORT || 5000;

//custom middle ware:
function verifyJWT(req, res, next) {
   const authHeader = req.headers.authorization;
   if (!authHeader) {
      return res.status(401).send({ message: "UnAuthorized Access" });
   }
   const token = authHeader.split(" ")[1];
   jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET,
      function (error, decoded) {
         if (error) {
            return res.status(403).send({ message: "Forbidden Access" });
         }
         req.decoded = decoded;
         next();
      }
   );
}

// middle ware:
app.use(cors());
app.use(express.static("public"));
app.use(express.json());

// mongodb configuration is here:

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.4nkvsmn.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
   useNewUrlParser: true,
   useUnifiedTopology: true,
   serverApi: ServerApiVersion.v1,
});

async function run() {
   try {
      const AppointmentOptionCollections = client
         .db("doctorsPortal")
         .collection("appointmentOptions");
      const bookingsCollections = client
         .db("doctorsPortal")
         .collection("bookings");
      const usersCollection = client.db("doctorsPortal").collection("users");
      const doctorsCollections = client
         .db("doctorsPortal")
         .collection("doctors");
      const paymentCollections =  client.db('doctorsPortal').collection('payment'); 

      //Note  : Make sure user after jwt verification :
      const verifyAdmin = async (req, res, next) => {
         const decodedEmail = req.decoded.email;
         const query = { email: decodedEmail };
         const user = await usersCollection.findOne(query);
         if (user?.role !== "admin") {
            res.status(403).send({ message: "Forbidden access" });
         }
         next();
      };

      app.get("/jwt", async (req, res) => {
         const email = req.query.email;
         const user = await usersCollection.findOne({ email: email });
         if (user) {
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
               expiresIn: "1d",
            });
            return res.send({ token: token });
         }
         res.status(403).send({ message: "Forbidden Access" });
      });

      app.get("/appointmentOptions", async (req, res) => {
         const query = {};
         const date = req.query.date;
         const bookingQuery = { appointmentDate: date };
         const options = await AppointmentOptionCollections.find(
            query
         ).toArray();
         const alreadyBooked = await bookingsCollections
            .find(bookingQuery)
            .toArray();

         options.forEach((option) => {
            const optionBooked = alreadyBooked.filter(
               (book) => book.treatment === option.name
            );
            const bookedSlots = optionBooked.map((book) => book.slot);
            const remaining = option.slots.filter(
               (slot) => !bookedSlots.includes(slot)
            );
            option.slots = remaining;
         });

         res.send(options);
      });

      app.get("/appointmentSpecialty", verifyJWT, async (req, res) => {
         const query = {};
         const specialty = await AppointmentOptionCollections.find(query)
            .project({ name: 1 })
            .toArray();
         res.send(specialty);
      });

      app.get("/bookings", verifyJWT, async (req, res) => {
         const email = req.query.email;
         const decodedEmail = req.decoded.email;
         if (email !== decodedEmail) {
            return res.status(403).send({ message: "forbidden access" });
         }
         const query = { email: email };
         const result = await bookingsCollections.find(query).toArray();
         res.send(result);
      });

      app.post("/bookings", verifyJWT, async (req, res) => {
         const booking = req.body;
         const query = {
            appointmentDate: booking.appointmentDate,
            email: booking.email,
            treatment: booking.treatment,
         };
         const bookedItem = await bookingsCollections.find(query).toArray();
         if (bookedItem.length) {
            const message = `You have already an appointment for ${booking.treatment} on ${booking.appointmentDate}`;
            return res.send({ acknowledged: false, message });
         }
         const result = await bookingsCollections.insertOne(booking);
         res.send(result);
      });

      app.get("/bookings/:id", async (req, res) => {
         const id = req.params.id;
         const booking = await bookingsCollections.findOne({
            _id: ObjectId(id),
         });
         res.send(booking);
      });

      app.post("/users", async (req, res) => {
         const user = req.body;
         const email = user.email;
         const query = { email: email };
         const prevUser = await usersCollection.findOne(query);
         if (prevUser) {
            return res.send({ alreadyAvailable: true });
         }

         const result = await usersCollection.insertOne(user);
         res.send(result);
      });

      app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
         const users = await usersCollection.find({}).toArray();
         res.send(users);
      });

      app.get("/users/admin/:email", verifyJWT, async (req, res) => {
         const email = req.params.email;
         const query = { email };
         const user = await usersCollection.findOne(query);
         const isAdmin = user.role === "admin";
         res.send({ isAdmin: isAdmin });
      });
      app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
         const id = req.params.id;
         const query = { _id: ObjectId(id) };
         const options = { upsert: true };
         const updatedUser = {
            $set: {
               role: "admin",
            },
         };
         const result = await usersCollection.updateOne(
            query,
            updatedUser,
            options
         );
         res.send(result);
      });

      app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
         const doctor = req.body;
         const result = await doctorsCollections.insertOne(doctor);
         res.send(result);
      });

      app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
         const query = {};
         const doctors = await doctorsCollections.find(query).toArray();
         res.send(doctors);
      });

      app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
         const id = req.params.id;
         const query = { _id: ObjectId(id) };
         const result = await doctorsCollections.deleteOne(query);
         res.send(result);
      });

      app.get("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
         const id = req.params.id;
         const query = { _id: ObjectId(id) };
         const doctor = await doctorsCollections.findOne(query);
         res.send(doctor);
      });

      // //temporary Update: for update price  of all appointment.
      // app.put('/addprice', async(req, res)=>{
      //    const query = {};
      //    const options = {upsert: true};
      //    const updatedDoc = {
      //       $set:{
      //          price: 200,
      //       }
      //    }
      //  const result = await AppointmentOptionCollections.updateMany(query, updatedDoc, options);
      //    res.send(result);
      // })

      app.post('/create-payment-intent', async(req, res)=> {
          const booking  = req.body; 
          const price = booking.price; 
          const amount = price * 100; 

          const paymentIntent = await stripe.paymentIntents.create({
            currency: 'usd', 
            amount: amount, 
            "payment_method_types": [
               "card"
           ]
          })


          res.send({
            clientSecret: paymentIntent.client_secret,
        });
      })


      app.post('/payments' ,async(req, res)=>{
         const payment = req.body; 
         const result = await paymentCollections.insertOne(payment); 
         const id = payment.bookingId; 
         const query = {_id: ObjectId(id)}; 
         const options = { upsert:true}; 
         const updatedDoc = {
            $set:{
               paid: true, 
               transaction_id: payment.transaction, 
            }
         }
         const updatedResult  = await bookingsCollections.updateOne(query, updatedDoc, options); 
         res.send(result); 
      })

      

      
      
     
   } finally {
   }
}

run().catch((err) => console.log(err));

app.get("/", (req, res) => {
   res.send("doctors portal server is running now.");
});

app.listen(port, () => {
   console.log("server is running on port ", port);
});
