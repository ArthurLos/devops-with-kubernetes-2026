const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const todos = [
  'Learn Kubernetes basics',
  'Deploy application to cluster',
  'Configure persistent volumes',
];

app.get('/todos', (req, res) => {
  res.json(todos);
});

app.post('/todos', (req, res) => {
  const text = (req.body.text || '').trim().slice(0, 140);
  if (text) {
    todos.push(text);
  }

  if (req.is('application/json')) {
    return res.status(201).json(todos);
  }
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
