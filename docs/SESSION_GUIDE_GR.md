# Οδηγός: πρώτη συνεδρία του George (Looming Shade)

## Ρόλοι

- **George**: παίζει τον **Looming Shade**, μόνο στο **#looming-private**, με τον δικό του λογαριασμό. Μόνο σε αυτόν απαντά εκεί ο DM.
- **Admin / παίκτης του Kraavok**: συντονίζει. Κάνει save και confirm και κάνει τους ελέγχους. Βλέπει το κανάλι του George αλλά δεν γράφει εκεί. Ως Kraavok, κάνει τον έκπληκτο 😄

---

## Μέρος Α: Κανόνες για τον George

- Ο DM απαντά **μόνο** όταν το μήνυμα ξεκινά με `@Dungeon Master`. Χωρίς αυτό, γράφεις ελεύθερα και δεν σε «ακούει».
- Γράφε σε **πρώτο πρόσωπο** («Κοιτάζω γύρω μου», «Ανοίγω την πόρτα»). Ο DM ξέρει ότι είσαι ο Looming Shade από τον λογαριασμό σου.
- Για ερωτήσεις εκτός παιχνιδιού, ξεκίνα με **(OOC)**.
- **Ζάρια:** με το **Avrae**, όπως πάντα. Μετά γράψε στον DM το αποτέλεσμα (π.χ. «Έφερα 17 στο Stealth»), γιατί ο DM δεν βλέπει το Avrae.
- Ο DM απαντά στη γλώσσα που του γράφεις.
- Ό,τι γίνεται στο κανάλι σου **μένει δικό σου**. Για να το μάθει ο Kraavok, πρέπει να του το πεις μέσα στο παιχνίδι, στο #main-adventure.
- Αν πας κάπου καινούργιο, μπορεί να εμφανιστεί αυτόματα μια **εικόνα** του τόπου.

**Χρήσιμες εντολές στο #looming-private:**

| Εντολή | Τι κάνει |
| --- | --- |
| `@Dungeon Master /checkpoint show` | Τι ξέρει ο ήρωάς σου |
| `@Dungeon Master /npc list` | Πρόσωπα που ξέρεις |
| `@Dungeon Master /location list` | Τόποι που ξέρεις |
| `@Dungeon Master /chronicle` | Γεγονότα που ξέρεις |
| `@Dungeon Master /image <τι να δείξει>` | Εικόνα της σκηνής (ημερήσιο όριο) |

---

## Μέρος Β: Η συνεδρία, βήμα προς βήμα

### Φάση 0: Προετοιμασία (admin)

1. Κάνε **restart** στο bot.
2. Στείλε στον George το **Μέρος Α**.
3. Στο **#dm-testing** στείλε `@Dungeon Master /checkpoint versions` και **σημείωσε τον αριθμό της τελευταίας έκδοσης**. Αυτό είναι το σημείο επιστροφής αν κάτι πάει στραβά.

### Φάση 1: Ο George παίζει (#looming-private)

4. **Αναγνώριση** (George):

   ```text
   @Dungeon Master (OOC) Γεια! Ποιος είμαι; Τι ξέρεις για μένα;
   ```

   ✅ *Έλεγχος:* τον λέει **Looming Shade, Rogue level 1**, όχι Kraavok, και δεν αναφέρει τίποτα από όσα ξέρει μόνο ο Kraavok.

5. **Σύσταση** (George), σε πρώτο πρόσωπο, OOC:

   ```text
   @Dungeon Master (OOC) Λίγα για μένα: Είμαι halfling (lightfoot), το πραγματικό μου όνομα είναι ... . Μεγάλωσα ... . Ήρθα στο Dunmere επειδή ... . Κουβαλάω ... . Θέλω να ... . Οι δεξιότητές μου: ... .
   ```

6. **Παιχνίδι** (George), π.χ.:

   ```text
   @Dungeon Master Κοιτάζω γύρω μου. Πού βρίσκομαι;
   ```

   Παίζει όσο θέλει. Για τα ζάρια χρησιμοποιεί το Avrae και μετά λέει το αποτέλεσμα στον DM.

7. Όταν κάνει παύση, λέει στον admin **«σταμάτησα»**. Μέχρι να τελειώσει το βήμα 10, **δεν γράφει στον DM**.

### Φάση 2: Checkpoint (admin)

8. **#main-adventure:**

   ```text
   @Dungeon Master /checkpoint save
   ```

   ✅ Απαντά με ένα σύντομο «Checkpoint draft ready…». Το πλήρες draft το βλέπεις στο βήμα 9.
   ⚠️ Αν δεις «New campaign messages arrived…», κάποιος έγραψε στο μεταξύ. Ξαναστείλε το save.

9. **#dm-testing:**

   ```text
   @Dungeon Master /checkpoint draft
   ```

   ✅ Στο κοινό κομμάτι (shared checkpoint) δεν φαίνεται **τίποτα** από όσα είπε ή έκανε ο George.
   ✅ Υπάρχει ενότητα **Looming Shade: private knowledge** με τα στοιχεία του.
   ✅ Στα DM notes, τα δικά του στοιχεία έχουν `known_by: ["Looming Shade"]`.

10. **#main-adventure** (ο ίδιος που έκανε το save):

    ```text
    @Dungeon Master /checkpoint confirm
    ```

    ✅ «Checkpoint vX confirmed».

### Φάση 3: Έλεγχοι μυστικότητας

11. **Admin, #kraavok-private:**

    ```text
    @Dungeon Master (OOC) Τι ξέρει ο Kraavok για τον Looming Shade;
    ```

    ✅ Δεν λέει **τίποτα** από τη σύσταση ή το παιχνίδι του George.

12. **Admin, #main-adventure:**

    ```text
    @Dungeon Master (OOC) Τι ξέρουμε για τον Looming Shade;
    ```

    ✅ Λέει ότι δεν έχει έρθει ακόμα στο κοινό παιχνίδι, χωρίς λεπτομέρειες.

13. **George, #looming-private:**

    ```text
    @Dungeon Master /checkpoint show
    ```

    ✅ Βλέπει το **δικό του** knowledge, χωρίς τίποτα του Kraavok και χωρίς DM notes.

14. **George, #looming-private:**

    ```text
    @Dungeon Master (OOC) Τι θυμάμαι για το παρελθόν μου;
    ```

    ✅ Τα θυμάται από τη σύστασή του.

---

## Αν κάτι πάει στραβά

| Πρόβλημα | Τι κάνεις |
| --- | --- |
| **Διαρροή** στο βήμα 8, 11 ή 12 | Στο **#main-adventure**: `@Dungeon Master /checkpoint rollback <έκδοση από το βήμα 3>`. Μετά καταγράφεις τι έγινε (βλ. `docs/OPERATIONS.md`). |
| **Λάθος draft** (ο DM κατάλαβε κάτι λάθος), **πριν** το confirm | `@Dungeon Master /checkpoint cancel`, ο George διορθώνει, και ξανά από το βήμα 8 |
| **«Dungeon Master error»** | Έλεγξε την κονσόλα του bot |

---

## Μετά

Ο George συνεχίζει κανονικά. Κάθε φορά που θέλετε να **«κλειδώσει» η πρόοδος**, επαναλαμβάνετε τη **Φάση 2**: παύση, save, έλεγχος draft, confirm.
