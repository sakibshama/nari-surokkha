"""Phrases for the keyword pipeline. Negatives must never contain the keywords."""
POS = {
 'help': {
   'en': ['Help!','Help me!','Help, help!','Somebody help!','Please help!','Help me please!','Help! Help! Help!','Someone help me!','Help','Help us!'],
   'bn': ['হেল্প','হেল্প মি','হেল্প! হেল্প!','প্লিজ হেল্প'],
   'hi': ['हेल्प','हेल्प मी','हेल्प! हेल्प!'],
   'ne': ['हेल्प','हेल्प मी'],
 },
 'bachao': {
   'bn': ['বাঁচাও','বাঁচাও!','বাঁচাও বাঁচাও!','আমাকে বাঁচাও!','কেউ বাঁচাও!','বাঁচাও, বাঁচাও!','বাচাও!','বাঁচাও প্লিজ'],
   'hi': ['बचाओ','बचाओ!','मुझे बचाओ!','बचाओ बचाओ!','कोई बचाओ!'],
   'ne': ['बचाऊ','बचाऊ!','मलाई बचाऊ!','बचाओ!','बचाओ बचाओ!'],
   'en': ['Bachao!','Bachaao!','Ba chao!','Bachao bachao!','Bachow!','Baachao!'],
 },
}
NEG = {
 'en': ['Hello there, how are you doing today?','Hell no, I am not going there.','He held the door open for me.','Yelp has good restaurant reviews.','Healthy food is important for kids.','I need a hand with this heavy box.','Let us go to the market tomorrow.','The weather is very nice today.','Watch out for that car!','Hey, wait for me!','Hey! Stop it!','Get out of here!','Leave me alone!','Hurry up, we are late!','Come here right now!','Where are you going?','Call me when you reach home.','The bachelor party was fun.','Batch number seven is ready.','Pass the chow mein please.','Ciao, see you later!','Bach composed beautiful music.','Wow, that is amazing!','Ouch, that hurts!','No, no, no, please stop!','Look at that!','Hello? Can you hear me?','Hallo, is anybody there?','Kelp grows in the ocean.','Whelp, that did not work.','The yellow bus is coming.','Hold on a second.','Shelf, self, delve, twelve.','We will hire more people.','Hope you are well.','Happy birthday to you!','Hep hep hooray!','Alpha, bravo, charlie.','I want to buy some chocolate.','Bad cow, go home.','Boxer, butcher, baker.','Batch out, go cow.','The coach shouted at the players.','Go go go! Run faster!','Goal! What a goal!','Yes! We won the match!','Taxi! Over here!','Mom, where is my bag?','Open the door please.'],
 'bn': ['আমি বাজারে যাচ্ছি','বাচ্চারা স্কুলে গেছে','চা খাবো','তুমি কেমন আছো','বাসায় চলো','আজকে বৃষ্টি হচ্ছে','বাঁধাকপি কিনে আনো','বাতাস ঠান্ডা','গান বাজাও','বাঁশি বাজাও','বাচ্চাটা কাঁদছে না','আমি বাঁচতে চাই না এখানে থাকতে','তুমি কি চাও','পাঁচটা আম দাও','ভাজা মাছ খাবো','বাবা বাড়ি আসছে','বাতি জ্বালাও','বাসটা চলে গেছে','আমাকে ডাকো','তাড়াতাড়ি এসো','দরজা খোলো','কোথায় যাচ্ছ','ভাত খেয়েছ','বাজার থেকে চাল আনো','আমার বাচ্চা ঘুমাচ্ছে','ওকে বাঁধো','সাবধানে যাও','হ্যালো, শুনতে পাচ্ছো','হেলে দুলে চলো','চলো খেলি'],
 'hi': ['मैं बाज़ार जा रहा हूँ','बच्चे खेल रहे हैं','चाय पियोगे?','बाजा बजाओ','बचपन के दिन','बत्ती जलाओ','चलो घर चलें','जल्दी आओ','दरवाज़ा खोलो','कहाँ जा रहे हो','हेलो, सुनाई दे रहा है','बचत करना ज़रूरी है','बाहर चलो','पानी लाओ'],
 'ne': ['म बजार जाँदैछु','बच्चाहरू खेलिरहेका छन्','चिया खानुहुन्छ?','घर जाऔं','छिटो आऊ','ढोका खोल','बत्ती बाल','कहाँ जाँदै हुनुहुन्छ'],
}
