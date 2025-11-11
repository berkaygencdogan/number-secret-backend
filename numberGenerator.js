// numberGenerator.js

const generateRandomNumber = () => {
  let digits = [];
  let number = "";

  // 0 dışındaki ilk rakam
  digits.push(Math.floor(Math.random() * 9) + 1);

  // Kalan 3 farklı rakam
  while (digits.length < 4) {
    const newDigit = Math.floor(Math.random() * 10);
    if (!digits.includes(newDigit)) {
      digits.push(newDigit);
    }
  }

  number = digits.join("");
  return number;
};

module.exports = generateRandomNumber;
