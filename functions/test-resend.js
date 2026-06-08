const { Resend } = require('resend');

const resend = new Resend('re_RUVbzmCM_2KLQSPaaVrUomUmqkVZFwMDc');

async function sendTestEmail() {
  try {
    const data = await resend.emails.send({
      from: 'Mojo CRM <info@digitalmojo.in>',
      to: ['dhiraj@digitalmojo.in'],
      subject: 'Test Email from Resend - Mojo CRM Integration',
      html: '<strong>It works!</strong> This is a test email sent from the newly configured Resend API.',
    });

    console.log('Email sent successfully:', data);
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}

sendTestEmail();
