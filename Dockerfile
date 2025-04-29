# Use a more specific Node.js version with Alpine
FROM node:18-alpine3.18

# Set the working directory in the container
WORKDIR /app

# Set environment variables
ENV PORT=5000 \
    NODE_ENV=development \
    MONGODB_URI="mongodb+srv://databse:databse@databse.howklu4.mongodb.net/?retryWrites=true&w=majority&appName=databse" \
    MAILTRAP_TOKEN="f0f1e8442010950d2c90e4e048705a7b" \
    MAILTRAP_SENDER_EMAIL="hello@vesarecine.xyz" \
    MAILTRAP_SENDER_NAME="Stringel App" \
    UPSTASH_REDIS_URL="rediss://default:AUpBAAIjcDFiMGY4MzgyNDJiMDA0ZWRkOTI1NzQ2YWQ2ZDcyYmEwN3AxMA@uncommon-seal-19009.upstash.io:6379" \
    SESSION_SECRET="1636a4d2ba19a49bb54a80dc7f6e1f5f37cf42eb072226dea75f2263afec3e96"

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./ 

# Install dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Build the application (optional if not using TypeScript or other build steps)
RUN npm run build

# Expose the port the app runs on
EXPOSE 5000

# Start the application
CMD ["npm", "start"]
