const { default: axios } = require("axios");

async function getCompletion({ messages, email, team, metadata }) {
  const response = await axios.post(
    `${process.env.API_BASE_URL}/chat/completions`,
    {
      messages,
      metadata,
    },
    {
      headers: {
        "x-slack-app-token": process.env.APP_TOKEN,
        "x-slack-email": email,
        "x-slack-team": team,
      },
    }
  );
  return response.data;
}

module.exports = { getCompletion };
