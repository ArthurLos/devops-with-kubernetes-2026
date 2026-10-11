FROM alpine:3.20

RUN apk add --no-cache bash curl

WORKDIR /usr/src/app
COPY add-random-todo.sh ./
RUN chmod +x add-random-todo.sh

CMD ["./add-random-todo.sh"]
