FROM node:18-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY worker.js .
EXPOSE 3002
CMD ["npm", "start"]
